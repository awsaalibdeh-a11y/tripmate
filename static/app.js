/* Tripmate: set up OpenAI's ChatKit chat window, connect it to our workflow through our own server, and make the
   waiting fun: a take-off screen, postcards that start a trip, a little plane while the agent searches. */
"use strict";

const $ = (id) => document.getElementById(id);

// ChatKit refuses to run on a site OpenAI hasn't been told about: say so instead of showing an empty box.
// (Listening from the very start: the error can come before anything else has loaded.)
addEventListener("unhandledrejection", (e) => {
  if (/domain verification/i.test(String(e.reason?.message || e.reason))) {
    showError(`This website (${location.host}) isn't on the OpenAI domain allowlist yet, so the chat can't start.`);
    landed();
  }
});

// A random id for this browser, so the same visitor keeps their chat history.
function visitorId() {
  try {
    let id = localStorage.getItem("tripmate.user");
    if (!id) { id = `u_${crypto.randomUUID().replace(/-/g, "")}`; localStorage.setItem("tripmate.user", id); }
    return id;
  } catch { return "anonymous"; }
}

function showError(msg) {
  $("chat-error").textContent = msg;
  $("chat-error").hidden = !msg;
}

async function getClientSecret() {
  const r = await fetch("/api/chatkit/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: visitorId() }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { showError(d.error || "Couldn't start the chat."); throw new Error(d.error || "session failed"); }
  showError("");
  return d.client_secret;
}

/* ---------- the take-off screen ---------- */
const TAKEOFF = ["Fastening seatbelts…", "Checking the weather…", "Clearing for take-off…", "Wheels up!"];
let takeoffLine = 0;
const takeoffTimer = setInterval(() => { takeoffLine = (takeoffLine + 1) % TAKEOFF.length; $("takeoff-line").textContent = TAKEOFF[takeoffLine]; }, 900);
const started = Date.now();
let hasLanded = false;
function landed() {
  if (hasLanded) return;                                            // ready, the fallback timer and errors can all call this
  hasLanded = true;
  const wait = Math.max(0, 2600 - (Date.now() - started));        // let the plane finish crossing the sky
  setTimeout(() => { clearInterval(takeoffTimer); $("takeoff")?.classList.add("gone"); setTimeout(() => $("takeoff")?.remove(), 800); }, wait);
}

/* ---------- postcards: tap one to start that trip ---------- */
const POSTCARDS = [
  { city: "Istanbul", emoji: "🕌", tint: "#ffb86b", prompt: "Dammam to Istanbul, then Istanbul to Dubai, then back to Dammam. A week in each city, starting next Sunday. Budget $1,000 for one person." },
  { city: "Dubai", emoji: "🏙️", tint: "#7cc4ff", prompt: "Riyadh to Dubai for a weekend next month, budget $400, one person." },
  { city: "Maldives", emoji: "🏝️", tint: "#5fe0c8", prompt: "From Jeddah, the cheapest beach holiday I can do for 5 days in November with $700." },
  { city: "Paris", emoji: "🗼", tint: "#ff9fb8", prompt: "Riyadh to Paris for 6 days in December, budget $1,200 for one person." },
  { city: "Tokyo", emoji: "🗾", tint: "#c9a7ff", prompt: "Dubai to Tokyo for 10 days in the spring, budget $1,800 for one person." },
  { city: "Surprise me", emoji: "🎲", tint: "#ffe07a", prompt: "Surprise me: the most interesting trip I can do for 5 days from Riyadh next month with $600." },
];
function postcards(chat) {
  $("postcards").replaceChildren(...POSTCARDS.map((p) => {
    const b = document.createElement("button");
    b.className = "postcard";
    b.type = "button";
    b.style.setProperty("--tint", p.tint);
    b.innerHTML = `<span class="stamp">${p.emoji}</span><b></b><small>Tap to plan</small>`;
    b.querySelector("b").textContent = p.city;
    b.addEventListener("click", () => {
      b.classList.add("sent");
      setTimeout(() => b.classList.remove("sent"), 900);
      chat.sendUserMessage({ text: p.prompt }).catch(() => {});
      if (innerWidth < 900) document.querySelector(".pass").scrollIntoView({ behavior: "smooth" });
    });
    return b;
  }));
}

/* ---------- small fun things ---------- */
const FACTS = [
  "Tuesdays and Wednesdays are often the cheapest days to fly.",
  "Booking about 1 to 3 months ahead usually beats booking last minute.",
  "Nearby airports can be much cheaper: try Bahrain instead of Dammam.",
  "A carry-on-only trip can save you $30 to $70 per flight on budget airlines.",
  "Istanbul has two airports: IST and SAW. Budget airlines love SAW.",
  "The world's shortest scheduled flight lasts about 90 seconds (in Scotland).",
];
let fact = Math.floor(Math.random() * FACTS.length);
function showFact() { $("fact").querySelector("span").textContent = FACTS[fact]; fact = (fact + 1) % FACTS.length; }
const WORDS = ["next?", "Istanbul?", "Dubai?", "Paris?", "the beach?", "Tokyo?"];
let word = 0;
function rotate() {
  const el = $("rotator");
  el.classList.add("out");
  setTimeout(() => { word = (word + 1) % WORDS.length; el.textContent = WORDS[word]; el.classList.remove("out"); }, 300);
}
function tickClock() { $("clock").textContent = `🕑 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; }
const WORKING = ["Searching flights…", "Comparing prices…", "Doing the maths…", "Checking your budget…", "Packing your plan…"];
let workTimer = null;
function working(on) {
  $("working").hidden = !on;
  clearInterval(workTimer);
  if (on) { let i = 0; $("working-line").textContent = WORKING[0]; workTimer = setInterval(() => { i = (i + 1) % WORKING.length; $("working-line").textContent = WORKING[i]; }, 1800); }
}

async function start() {
  await customElements.whenDefined("openai-chatkit");
  const chat = $("chat");
  chat.setOptions({
    // a workflow hosted by OpenAI: the domain allowlist (checked by the page's address) is all it needs.
    // (A domainKey is only for a self-hosted chat backend; setting one here switches ChatKit into that mode.)
    api: { getClientSecret },
    theme: { colorScheme: "light", radius: "round", color: { accent: { primary: "#2b7fff", level: 1 } } },
    header: { enabled: false },
    startScreen: {
      greeting: "Where do you want to go? 🌍",
      prompts: [
        { label: "✈️ A 3-city trip on $1,000", prompt: POSTCARDS[0].prompt },
        { label: "🏙️ Weekend in Dubai", prompt: POSTCARDS[1].prompt },
        { label: "🏝️ Cheapest beach trip", prompt: POSTCARDS[2].prompt },
      ],
    },
    composer: { placeholder: "From where, to where, when, and your budget…" },
  });
  chat.addEventListener("chatkit.ready", landed);
  chat.addEventListener("chatkit.response.start", () => working(true));
  chat.addEventListener("chatkit.response.end", () => working(false));
  chat.addEventListener("chatkit.error", () => working(false));
  setTimeout(landed, 4000);                                        // never keep the plane circling forever
  postcards(chat);
  $("new-chat").addEventListener("click", () => location.reload());
}

tickClock(); setInterval(tickClock, 15000);
showFact(); setInterval(showFact, 9000);
setInterval(rotate, 2600);
start().catch((e) => { console.error(e); landed(); showError("The chat couldn't load. Check your connection and refresh."); });
