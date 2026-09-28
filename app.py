"""Tripmate: a budget travel helper on the web.

The page sends the conversation to POST /api/chat; the agent (agent.py) researches real flights with web search,
checks the budget, and writes a plan or cheaper options, streaming each step back. The API key never leaves this
server.
"""

import json
import logging
import os
import re
import threading
import time

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tripmate")

SESSIONS_PER_HOUR = int(os.environ.get("MESSAGES_PER_HOUR", "40"))      # per visitor: every message spends money
BASE = os.path.dirname(os.path.abspath(__file__))

import agent  # noqa: E402  (after load_dotenv, so it sees OPENAI_MODEL)

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True

_lock = threading.Lock()
_hits = {}


def _limited():
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "?")).split(",")[0].strip()
    now = time.time()
    with _lock:
        recent = [t for t in _hits.get(ip, []) if now - t < 3600]
        if len(recent) >= SESSIONS_PER_HOUR:
            _hits[ip] = recent
            return True
        recent.append(now)
        _hits[ip] = recent
    return False


def _version():
    files = [os.path.join(BASE, "static", f) for f in os.listdir(os.path.join(BASE, "static"))]
    return str(int(max(os.path.getmtime(f) for f in files)))


@app.after_request
def headers(resp):
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.headers.get("X-Forwarded-Proto", request.scheme) == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.path.startswith("/static/"):
        h["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") else "public, max-age=3600"
    return resp


@app.route("/")
def index():
    resp = app.make_response(render_template("index.html", v=_version()))
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/healthz")
def healthz():
    return "ok"


@app.post("/api/chat")
def chat():
    """Run the agent on the conversation so far and stream what it does, one JSON event per line."""
    if not os.environ.get("OPENAI_API_KEY"):
        return jsonify(error="The site isn't connected to OpenAI yet."), 503
    if _limited():
        return jsonify(error="That's a lot of trips in an hour. Try again in a while."), 429
    body = request.get_json(silent=True) or {}
    history = []
    for m in (body.get("messages") or [])[-20:]:                     # the last 20 turns are plenty of context
        role, text = m.get("role"), str(m.get("content") or "")[:4000]
        if role in ("user", "assistant") and text.strip():
            history.append({"role": role, "content": text})
    if not history or history[-1]["role"] != "user":
        return jsonify(error="Say where you'd like to go."), 400

    def line(event):
        return json.dumps(event) + "\n"

    def stream():
        try:
            for event in agent.run(history):
                yield line(event)
        except Exception as exc:                                     # show the traveller something human, log the rest
            log.exception("agent failed")
            yield line({"type": "error", "text": str(exc) if isinstance(exc, RuntimeError) else "Something went wrong. Try again."})
        yield line({"type": "done"})

    resp = Response(stream_with_context(stream()), mimetype="application/x-ndjson")
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5095)), debug=False)
