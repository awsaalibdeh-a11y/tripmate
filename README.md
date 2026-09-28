# Tripmate

A budget travel helper: tell it where you're flying from and to, your dates and your budget. It searches real flights
on the web, checks them against your budget, and either plans your days or suggests cheaper options.

## The agent (agent.py)

The same design as the Agent Builder workflow it started as, run in code on this server:

1. **Researcher** reads the whole conversation (details often arrive over several messages), searches the web for
   each flight, and returns data: either one friendly question for what's missing, or the flights with prices in USD
   and booking links. Its searches stream to the page as they happen.
2. **Budget check** is plain code: total vs budget.
3. **Writer** streams the answer: a day-by-day plan when it fits, cheaper options when it doesn't.

The page shows the flights as boarding-pass tickets with a budget meter, then the plan word by word. The conversation
is kept in the visitor's browser.

## Run it

```bash
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5095
```

Environment: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (default gpt-5.5), `MESSAGES_PER_HOUR` (per visitor,
default 40: every message costs money).
