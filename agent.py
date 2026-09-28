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
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")
URL = "https://api.openai.com/v1/responses"

TRIP_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["ready", "question", "from_city", "to_city", "travellers", "budget_usd", "flights", "total_usd", "notes"],
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
        "total_usd": {"type": "number"},
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
5. Otherwise ready true: use web search to find real, current prices for EACH flight separately. Convert to US dollars.
   Every flight needs a real link where you found it. Never invent a price; if you truly can't find one, leave that
   flight out and say so in notes. total_usd is the sum of the flights."""

WRITER_FITS = """You are Tripmate, a warm, upbeat budget travel buddy. Today is {today}.
The flights below FIT the traveller's budget. The page already shows each flight as a ticket with its price and link,
so don't repeat that list. Write:
- one short line celebrating it (how much of the budget is left),
- a day-by-day plan for each city (a few lines per day: what to see, cheap eats, how to get around), keeping the whole
  trip in budget: say roughly what the rest of the money covers,
- 2-3 money-saving tips specific to these places.
Use short headings and bullet points (markdown). Friendly, not over the top. End with one question about what to help
with next (hotels? a different day?)."""

WRITER_OVER = """You are Tripmate, a warm budget travel buddy. Today is {today}.
The flights below cost MORE than the traveller's budget. The page already shows the flights as tickets, so don't repeat
them. Write:
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


def research(history):
    """Step 1: yields ("status", text) while searching, then ("trip", data)."""
    body = {
        "model": MODEL, "stream": True, "reasoning": {"effort": "low"}, "tools": [{"type": "web_search"}],
        "input": [{"role": "system", "content": RESEARCHER.format(today=_today())}] + history,
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
    data = json.dumps({k: trip[k] for k in ("from_city", "to_city", "travellers", "budget_usd", "flights", "total_usd", "notes")})
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


def run(history):
    """The whole agent, as events for the browser."""
    trip = None
    for kind, value in research(history):
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
