"""Tripmate: a budget travel helper on the web, powered by an Agent Builder workflow and OpenAI's ChatKit.

How the pieces fit:
  1. The page loads ChatKit (OpenAI's chat window) from OpenAI's CDN.
  2. ChatKit asks this server for a session: POST /api/chatkit/session.
  3. This server, which holds the API key, asks OpenAI for a short-lived client secret tied to the workflow, and
     hands only that secret back. The API key itself never reaches the browser.
  4. ChatKit then talks to OpenAI directly, and OpenAI runs the workflow (guardrails, Travel helper, the branches).
"""

import logging
import os
import re
import threading
import time

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tripmate")

WORKFLOW_ID = os.environ.get("WORKFLOW_ID", "wf_6ab94f45cb588190b9cd2aee3ba2f50506b6d2a8fbd217e7")
SESSIONS_PER_HOUR = int(os.environ.get("SESSIONS_PER_HOUR", "30"))      # per visitor: every session can spend money
BASE = os.path.dirname(os.path.abspath(__file__))

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


@app.post("/api/chatkit/session")
def session():
    """Swap our secret API key for a short-lived ChatKit client secret for this visitor."""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return jsonify(error="The site isn't connected to OpenAI yet."), 503
    if _limited():
        return jsonify(error="Too many chats started from here. Try again in a while."), 429
    body = request.get_json(silent=True) or {}
    user = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("user") or ""))[:64] or "anonymous"
    try:
        r = requests.post("https://api.openai.com/v1/chatkit/sessions", timeout=20,
                          headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "OpenAI-Beta": "chatkit_beta=v1"},
                          json={"workflow": {"id": WORKFLOW_ID}, "user": user})
    except requests.RequestException:
        return jsonify(error="Couldn't reach OpenAI. Try again in a moment."), 502
    if not r.ok:
        log.error("ChatKit session %s: %s", r.status_code, r.text[:300])
        return jsonify(error="OpenAI didn't start the chat. Try again in a moment."), 502
    d = r.json()
    return jsonify(client_secret=d["client_secret"], expires_at=d.get("expires_at"))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5095)), debug=False)
