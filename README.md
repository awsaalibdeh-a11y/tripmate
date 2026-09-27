# Tripmate

A budget travel helper: tell it where you're flying from and to, your dates and your budget. It searches real flights,
checks the budget, and either plans your days or suggests cheaper options.

The brains are an **Agent Builder workflow** (guardrails → Travel helper with web search → if/else → Trip planner,
Budget saver or Ask for details). This site only hosts OpenAI's **ChatKit** chat window and connects it to that
workflow.

## How it works

1. The page loads ChatKit from OpenAI's CDN.
2. ChatKit asks this server for a session (`POST /api/chatkit/session`).
3. The server, which holds `OPENAI_API_KEY`, asks OpenAI for a short-lived client secret for the workflow and hands only
   that back. The API key never reaches the browser.
4. ChatKit talks to OpenAI directly and OpenAI runs the workflow. Publishing a new version in Agent Builder updates the
   site with no code change.

## Run it

```bash
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5095
```

Environment: `OPENAI_API_KEY` (required), `WORKFLOW_ID` (defaults to the Tripmate workflow), `SESSIONS_PER_HOUR`
(per visitor, default 30: every chat costs money).
