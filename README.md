# Tripmate

A budget travel helper: tell it where you're flying from and to, your dates and your budget. It searches real flights
on the web, checks them against your budget, and either plans your days or suggests cheaper options.

## The agent (agent.py)

The same design as the Agent Builder workflow it started as, run in code on this server:

1. **Researcher** reads the whole conversation (details often arrive over several messages), searches the web for
   each flight and a cheap place to stay in each city, and returns data: either one friendly question for what's missing, or the flights and stays with prices in USD
   and booking links. Its searches stream to the page as they happen.
2. **Budget check** is plain code: total vs budget.
3. **Writer** streams the answer: a day-by-day plan when it fits, cheaper options when it doesn't.

Follow-up questions skip the flight search: a quick **router** (gpt-5-nano, ~2 s) decides whether the latest message
changes the trip (search again) or just asks about it (food, visas, weather, packing), which an **answerer** handles
with web search, streamed.

**Explore** (`POST /api/explore`) suggests 6 places from the visitor's home city, about half inside their own country
and half nearby abroad, for a vibe, number of days, budget and month (~12 s, no web search: rough costs only).
Home is guessed from the time zone, or set by typing or "Use my location" (asked only on tap; coordinates rounded to
~1 km and named by BigDataCloud's free client-side reverse geocoder). Saved trips live in the browser with a countdown.

The page shows the flights as boarding-pass tickets with a budget meter, then the plan word by word. The conversation
is kept in the visitor's browser.

## Run it

```bash
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5095
```

Environment: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (default gpt-5-mini: tested against gpt-5.5, as good for this and ~20x cheaper), `ROUTER_MODEL` (default gpt-5-nano), `MESSAGES_PER_HOUR` (per visitor,
default 40: every message costs money).
