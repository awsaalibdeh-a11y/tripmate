"""Tripmate's server, tested with the agent faked out (no AI calls, no cost).

    python -m unittest discover tests
"""

import json
import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

import app as server  # noqa: E402


def fake_run(history, home=""):
    yield {"type": "status", "text": "Searched: test"}
    yield {"type": "trip", "trip": {"total_usd": 100, "budget_usd": 300}, "fits": True}
    yield {"type": "delta", "text": "Have a great trip"}


class Chat(unittest.TestCase):
    def setUp(self):
        self.c = server.app.test_client()
        server._hits.clear()
        os.environ.setdefault("OPENAI_API_KEY", "test")

    def test_page(self):
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn('id="composer"', r.get_data(as_text=True))

    def test_streams_the_agent_as_json_lines(self):
        with mock.patch.object(server.agent, "run", fake_run):
            r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "Riyadh to Dubai"}]})
        events = [json.loads(x) for x in r.get_data(as_text=True).splitlines() if x.strip()]
        self.assertEqual([e["type"] for e in events], ["status", "trip", "delta", "done"])

    def test_needs_a_user_message_last(self):
        r = self.c.post("/api/chat", json={"messages": [{"role": "assistant", "content": "hi"}]})
        self.assertEqual(r.status_code, 400)

    def test_errors_become_a_friendly_event(self):
        def boom(history, home=""):
            raise RuntimeError("The flight search failed. Try again in a moment.")
            yield
        with mock.patch.object(server.agent, "run", boom):
            r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "x"}]})
        events = [json.loads(x) for x in r.get_data(as_text=True).splitlines() if x.strip()]
        self.assertEqual(events[0], {"type": "error", "text": "The flight search failed. Try again in a moment."})

    def test_rate_limit(self):
        with mock.patch.object(server.agent, "run", fake_run):
            for _ in range(server.SESSIONS_PER_HOUR):
                self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "x"}]})
            r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "x"}]})
        self.assertEqual(r.status_code, 429)

    def test_home_reaches_the_agent_cleaned(self):
        seen = {}
        def spy(history, home=""):
            seen["home"] = home
            yield {"type": "delta", "text": "hi"}
        with mock.patch.object(server.agent, "run", spy):
            self.c.post("/api/chat", json={"home": "Riyadh, Saudi Arabia<script>", "messages": [{"role": "user", "content": "x"}]}).get_data()
        self.assertEqual(seen["home"], "Riyadh, Saudi Arabiascript")

    def test_explore_returns_places(self):
        with mock.patch.object(server.agent, "explore", lambda *a: [{"name": "AlUla"}]) as _:
            r = self.c.post("/api/explore", json={"home": "Riyadh", "days": "4", "budget": "600", "vibe": "desert"})
        self.assertEqual(r.get_json(), {"places": [{"name": "AlUla"}]})
        self.assertEqual(self.c.post("/api/explore", json={"days": "lots"}).status_code, 400)

    def test_rates_fall_back_to_pegs(self):
        server._rates["at"] = 0
        with mock.patch.object(server.requests, "get", side_effect=OSError("offline")):
            r = self.c.get("/api/rates")
        self.assertEqual(r.get_json()["rates"]["SAR"], 3.75)


if __name__ == "__main__":
    unittest.main()
