"""Tripmate's agent, in code: the same design as the Agent Builder workflow, run on our own server.

  1. researcher  reads the whole conversation, searches the web for real flights, and returns data (JSON): either
                 "not ready" with one question to ask, or the flights with prices and links
  2. budget      plain code: is the total within the budget?
  3. writer      streams the answer the traveller reads: a day-by-day plan when it fits the budget, cheaper options
                 when it doesn't

Everything streams to the browser as newline-delimited JSON events, so the page can show what the agent is doing
("searching: dammam to jeddah flights…"), then the flight tickets, then the plan word by word.
"""

import datetime as dt
import json
import logging
import os

import requests

log = logging.getLogger("tripmate")
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")        # tested against gpt-5.5: as good at this, ~20x cheaper
URL = "https://api.openai.com/v1/responses"

TRIP_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["ready", "question", "from_city", "to_city", "travellers", "budget_usd", "flights", "stays", "flights_usd", "stays_usd", "total_usd", "notes"],
    "properties": {
        "ready": {"type": "boolean", "description": "true only when origin, destination, dates and budget are all known"},
        "question": {"type": "string", "description": "when not ready: ONE short friendly question asking only for what is missing; else empty"},
        "from_city": {"type": "string"},
        "to_city": {"type": "string", "description": "main destination (for a multi-city trip, the first one)"},
        "travellers": {"type": "integer"},
        "budget_usd": {"type": "number", "description": "the traveller's budget in US dollars (convert if needed); 0 if unknown"},
        "flights": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["date", "from", "to", "airline", "price_usd", "link"],
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "from": {"type": "string", "description": "city and airport code, e.g. Dammam (DMM)"},
                "to": {"type": "string"},
                "airline": {"type": "string"},
                "price_usd": {"type": "number", "description": "for all travellers, in USD"},
                "link": {"type": "string", "description": "a real booking or search page where this price was found"},
            }}},
        "stays": {"type": "array", "description": "one cheap but decent place per city with overnight stays; empty if they have somewhere to stay or only want flights", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["city", "nights", "name", "price_per_night_usd", "link"],
            "properties": {
                "city": {"type": "string"},
                "nights": {"type": "integer"},
                "name": {"type": "string", "description": "a real hotel or apartment, well reviewed for its price"},
                "price_per_night_usd": {"type": "number", "description": "for the whole group, per night, in USD"},
                "link": {"type": "string", "description": "a real page where this price was found"},
            }}},
        "flights_usd": {"type": "number"},
        "stays_usd": {"type": "number", "description": "sum of nights x price per night"},
        "total_usd": {"type": "number", "description": "flights_usd + stays_usd"},
        "notes": {"type": "string", "description": "anything the traveller should know: bags not included, price is an estimate, etc."},
    },
}

RESEARCHER = """You are Tripmate's flight researcher. You never talk to the traveller: you only fill in the JSON.
Today is {today}.

1. Read the WHOLE conversation. Travellers give details over several messages (a date in one, the budget in another,
   "yes" to your question). Combine everything.
2. You need: where from, where to, travel date(s), and a budget. Assume 1 traveller unless told otherwise. A date with no
   year means the next time that date comes. "After three days" means three days after departure. Don't ask for a return
   date unless they want a return trip.
3. If the message isn't about travel at all, set ready to false and in question kindly steer them back to planning a trip.
4. If something essential is missing: ready false, and question = ONE short, friendly question for only what's missing.
5. Otherwise ready true: use web search to find real, current prices for EACH flight separately, and one cheap but decent
   place to stay in each city where they spend nights (unless they said they have somewhere, or only want flights).
   Convert everything to US dollars. Every flight and stay needs a real link where you found it. Never invent a price;
   if you truly can't find one, leave it out and say so in notes. flights_usd and stays_usd are the sums; total_usd is both."""

WRITER_FITS = """You are Tripmate, a warm, upbeat budget travel buddy. Today is {today}.
The flights and stays below FIT the traveller's budget. The page already shows them as tickets with prices and links,
so don't repeat that list. Write:
- one short line celebrating it (how much of the budget is left for food, transport and fun),
- a day-by-day plan for each city (a few lines per day: what to see, cheap eats, how to get around), keeping the whole
  trip in budget: say roughly what the rest of the money covers,
- 2-3 money-saving tips specific to these places.
Use short headings and bullet points (markdown). Friendly, not over the top. End with one question about what to help
with next (hotels? a different day?)."""

WRITER_OVER = """You are Tripmate, a warm budget travel buddy. Today is {today}.
The flights and stays below cost MORE than the traveller's budget. The page already shows them as tickets, so don't
repeat them. Write:
- one sentence saying by how much it's over (never comment on the traveller's money itself),
- 3 concrete cheaper options, each with why it saves money (other dates, nearby airports like Bahrain for Dammam, budget
  airlines, fewer nights, a cheaper destination nearby). Only quote a price if it's in the data below.
- end by asking whether they'd like to try one of these or raise the budget.
Short headings and bullet points (markdown)."""


def _today():
    return dt.date.today().strftime("%A %d %B %Y")


def _headers():
    return {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}", "Content-Type": "application/json"}


def _sse(resp):
    """Server-sent events from the Responses API, as (event type, data) pairs."""
    for raw in resp.iter_lines():
        line = raw.decode("utf-8", "replace")
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            ev = json.loads(data)
        except ValueError:
            continue
        yield ev.get("type", ""), ev


def _home_note(home):
    return f"The traveller lives in {home}: use it as the starting point unless they say otherwise." if home else ""


def research(history, home=""):
    """Step 1: yields ("status", text) while searching, then ("trip", data)."""
    body = {
        "model": MODEL, "stream": True, "reasoning": {"effort": "low"}, "tools": [{"type": "web_search"}],
        "input": [{"role": "system", "content": RESEARCHER.format(today=_today()) + "\n" + _home_note(home)}] + history,
        "text": {"format": {"type": "json_schema", "name": "trip", "schema": TRIP_SCHEMA, "strict": True}},
    }
    text = ""
    with requests.post(URL, headers=_headers(), json=body, stream=True, timeout=(10, 150)) as resp:
        if not resp.ok:
            log.error("research %s: %s", resp.status_code, resp.text[:400])
            raise RuntimeError("The flight search didn't start. Try again in a moment.")
        for kind, ev in _sse(resp):
            if kind == "response.output_item.done" and ev.get("item", {}).get("type") == "web_search_call":
                action = ev["item"].get("action") or {}
                q = action.get("query") or (action.get("url") and f"reading {action['url'][:60]}")
                if q:
                    yield "status", f"Searched: {q}"
            elif kind == "response.web_search_call.in_progress":
                yield "status", "Searching the web…"
            elif kind == "response.output_text.delta":
                text += ev.get("delta", "")
            elif kind in ("response.failed", "error"):
                raise RuntimeError("The flight search failed. Try again in a moment.")
    try:
        yield "trip", json.loads(text)
    except ValueError:
        raise RuntimeError("The flight search came back garbled. Try again.")


def write(history, trip, fits):
    """Step 3: streams the answer, a piece at a time."""
    prompt = (WRITER_FITS if fits else WRITER_OVER).format(today=_today())
    data = json.dumps({k: trip[k] for k in ("from_city", "to_city", "travellers", "budget_usd", "flights", "stays", "flights_usd", "stays_usd", "total_usd", "notes")})
    body = {"model": MODEL, "stream": True, "reasoning": {"effort": "low"},
            "input": [{"role": "system", "content": prompt}] + history + [{"role": "system", "content": f"Flight data: {data}"}]}
    with requests.post(URL, headers=_headers(), json=body, stream=True, timeout=(10, 120)) as resp:
        if not resp.ok:
            log.error("write %s: %s", resp.status_code, resp.text[:400])
            yield "Sorry, I couldn't write the plan just now. Ask me again?"
            return
        for kind, ev in _sse(resp):
            if kind == "response.output_text.delta":
                yield ev.get("delta", "")


ROUTER = """You route messages in a travel-planning chat. Look at the conversation and the LATEST message.
Answer "research" if the latest message starts a trip, or gives or changes trip details (where from/to, dates, budget,
number of people, nights), or asks to search flights or hotels again ("cheaper dates", "nearby airports", "raise my
budget to...", "add another city").
Answer "answer" if it's a question or request that doesn't change the trip: food, things to do, packing, visas, weather,
transport, safety, tips, a packing list, what to wear, or small talk.
Reply as JSON: {"action": "research" | "answer"}"""

ANSWERER = """You are Tripmate, a warm, upbeat budget travel buddy. Today is {today}. {home}
Answer the traveller's latest message using the conversation (it may include flights and stays already found).
Use web search when you need current facts (visa rules, weather, opening hours, prices) and link your sources.
Be concise and practical: short headings and bullet points (markdown), no more than about 180 words unless they ask
for a list (like a packing list). If the message isn't about travel, answer briefly and kindly steer back to trips."""


def route(history):
    """A quick, cheap decision: search again, or just answer?"""
    try:
        r = requests.post(URL, headers=_headers(), timeout=(10, 30), json={
            "model": os.environ.get("ROUTER_MODEL", "gpt-5-nano"), "reasoning": {"effort": "minimal"},
            "input": [{"role": "system", "content": ROUTER}] + history[-8:],
            "text": {"format": {"type": "json_schema", "name": "route", "strict": True, "schema": {
                "type": "object", "additionalProperties": False, "required": ["action"],
                "properties": {"action": {"type": "string", "enum": ["research", "answer"]}}}}}})
        r.raise_for_status()
        msg = [o for o in r.json()["output"] if o["type"] == "message"][-1]["content"][0]["text"]
        return json.loads(msg)["action"]
    except Exception as exc:                                         # when unsure, the full search is the safe choice
        log.warning("router fell back to research: %s", exc)
        return "research"


def answer(history, home=""):
    """Answer a question about the trip (searching the web if needed), streamed."""
    body = {"model": MODEL, "stream": True, "reasoning": {"effort": "low"}, "tools": [{"type": "web_search"}],
            "input": [{"role": "system", "content": ANSWERER.format(today=_today(), home=_home_note(home))}] + history}
    with requests.post(URL, headers=_headers(), json=body, stream=True, timeout=(10, 120)) as resp:
        if not resp.ok:
            log.error("answer %s: %s", resp.status_code, resp.text[:400])
            yield "status", "…"
            yield "delta", "Sorry, I couldn't answer that just now. Ask me again?"
            return
        for kind, ev in _sse(resp):
            if kind == "response.output_item.done" and ev.get("item", {}).get("type") == "web_search_call":
                q = (ev["item"].get("action") or {}).get("query")
                if q:
                    yield "status", f"Searched: {q}"
            elif kind == "response.output_text.delta":
                yield "delta", ev.get("delta", "")


EXPLORE_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["places"],
    "properties": {"places": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["name", "country", "emoji", "domestic", "why", "flight_hours", "est_flight_usd", "est_daily_usd", "est_total_usd", "best_months", "highlight"],
        "properties": {
            "name": {"type": "string"}, "country": {"type": "string"}, "emoji": {"type": "string", "description": "one emoji for the place"},
            "domestic": {"type": "boolean", "description": "inside the traveller's own country"},
            "why": {"type": "string", "description": "one sentence: why it fits their vibe and budget"},
            "flight_hours": {"type": "number", "description": "0 if it's better by road or train"},
            "est_flight_usd": {"type": "number", "description": "rough return fare per person"},
            "est_daily_usd": {"type": "number", "description": "rough budget stay + food + local transport per day"},
            "est_total_usd": {"type": "number"},
            "best_months": {"type": "string"},
            "highlight": {"type": "string", "description": "the one thing not to miss, 3-6 words"},
        }}}},
}

EXPLORER = """You suggest trip ideas for a budget traveller. Today is {today}. They live in {home}.
Suggest 6 places that fit their vibe, their number of days and their budget: about half INSIDE their own country
(domestic trips, including by road or train) and the rest NEARBY abroad (short flights). Prefer places that are good in
the month they're travelling. Costs are rough estimates for one person in US dollars; keep est_total_usd honest
(flights + days x daily) and within their budget where possible. Real places only, no two in the same city."""


def explore(home, days, budget, vibe, month):
    """Trip ideas near home: quick, from the model's own knowledge (no web search), as data."""
    ask = f"Vibe: {vibe or 'anything fun'}. Days: {days}. Budget: ${budget} per person. Travelling in: {month or 'the next couple of months'}."
    r = requests.post(URL, headers=_headers(), timeout=(10, 60), json={
        "model": MODEL, "reasoning": {"effort": "minimal"},
        "input": [{"role": "system", "content": EXPLORER.format(today=_today(), home=home or "Riyadh, Saudi Arabia")}, {"role": "user", "content": ask}],
        "text": {"format": {"type": "json_schema", "name": "explore", "schema": EXPLORE_SCHEMA, "strict": True}}})
    if not r.ok:
        log.error("explore %s: %s", r.status_code, r.text[:400])
        raise RuntimeError("Couldn't come up with ideas just now. Try again.")
    msg = [o for o in r.json()["output"] if o["type"] == "message"][-1]["content"][0]["text"]
    return json.loads(msg)["places"]


def run(history, home=""):
    """The whole agent, as events for the browser."""
    if len([m for m in history if m["role"] == "user"]) > 1 and route(history) == "answer":
        yield {"type": "status", "text": "Thinking…"}
        for kind, value in answer(history, home):
            yield {"type": kind, "text": value}
        return
    trip = None
    for kind, value in research(history, home):
        if kind == "status":
            yield {"type": "status", "text": value}
        else:
            trip = value
    if not trip["ready"]:
        yield {"type": "delta", "text": trip["question"] or "Where are you flying from and to, when, and what's your budget?"}
        return
    budget = trip["budget_usd"] or 0
    fits = budget > 0 and trip["total_usd"] <= budget                   # step 2: plain code, no AI needed
    yield {"type": "trip", "trip": trip, "fits": fits}
    yield {"type": "status", "text": "Writing your plan…" if fits else "Finding cheaper options…"}
    for piece in write(history, trip, fits):
        yield {"type": "delta", "text": piece}
