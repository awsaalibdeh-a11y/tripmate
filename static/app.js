/* Tripmate: set up OpenAI's ChatKit chat window and connect it to our workflow through our own server. */
"use strict";

// A random id for this browser, so the same visitor keeps their chat history.
function visitorId() {
  try {
    let id = localStorage.getItem("tripmate.user");
    if (!id) { id = `u_${crypto.randomUUID().replace(/-/g, "")}`; localStorage.setItem("tripmate.user", id); }
    return id;
  } catch { return "anonymous"; }
}

function showError(msg) {
  const box = document.getElementById("chat-error");
  box.textContent = msg;
  box.hidden = !msg;
}

async function getClientSecret() {
  const r = await fetch("/api/chatkit/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: visitorId() }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { showError(d.error || "Couldn't start the chat."); throw new Error(d.error || "session failed"); }
  showError("");
  return d.client_secret;
}

async function start() {
  await customElements.whenDefined("openai-chatkit");
  const chat = document.getElementById("chat");
  chat.setOptions({
    api: { getClientSecret },
    theme: { colorScheme: "light", radius: "round", color: { accent: { primary: "#1f6feb", level: 1 } } },
    header: { enabled: false },
    startScreen: {
      greeting: "Where do you want to go?",
      prompts: [
        { label: "A 3-city trip on $1,000", prompt: "Dammam to Istanbul, then Istanbul to Dubai, then back to Dammam. A week in each city, starting next Sunday. Budget $1,000 for one person." },
        { label: "Weekend in Dubai", prompt: "Riyadh to Dubai for a weekend next month, budget $400, one person." },
        { label: "Cheapest beach trip", prompt: "From Jeddah, the cheapest beach holiday I can do for 5 days in November with $700." },
      ],
    },
    composer: { placeholder: "From where, to where, when, and your budget…" },
  });
  document.getElementById("new-chat").addEventListener("click", () => location.reload());
}

start().catch((e) => { console.error(e); showError("The chat couldn't load. Check your connection and refresh."); });
