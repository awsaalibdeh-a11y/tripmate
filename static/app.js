/* Tripmate: the chat. Sends the conversation to our server, which runs the agent, and shows each step as it streams
   back: what it's searching, the flights as boarding-pass tickets with a budget meter, then the plan word by word.
   The conversation is kept in this browser, so a refresh doesn't lose it. */
"use strict";

const $ = (id) => document.getElementById(id);
const KEY = "tripmate.chat";
let history = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } })();
let busy = false;
let controller = null;                                              // lets Stop cancel the request in flight
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(history.slice(-40))); } catch { /* private mode */ } };

/* ---------- tiny safe markdown: headings, bullets, bold, links ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">link ↗</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}
function markdown(text) {
  const out = [];
  let list = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line) || /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) { if (!list) { list = []; out.push(list); } list.push(`<li>${inline(bullet[1])}</li>`); continue; }
    list = null;
    if (!line) continue;
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    out.push(head ? `<h4>${inline(head[1])}</h4>` : `<p>${inline(line)}</p>`);
  }
  return out.map((x) => (Array.isArray(x) ? `<ul>${x.join("")}</ul>` : x)).join("");
}

/* ---------- messages ---------- */
function bubble(role, html) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.innerHTML = html;
  $("msgs").append(el);
  scrollDown();
  return el;
}
const scrollDown = () => { const m = $("msgs"); m.scrollTop = m.scrollHeight; };
// Saudi riyals are pegged at 3.75 to the dollar, so the switch is exact enough for planning
let currency = (() => { try { return localStorage.getItem("tripmate.cur") || "USD"; } catch { return "USD"; } })();
const money = (n) => (currency === "SAR" ? `${Math.round(n * 3.75).toLocaleString()} SAR` : `$${Math.round(n).toLocaleString()}`);
const code = (place) => (/\(([A-Z]{3})\)/.exec(place || "") || [])[1] || String(place || "").slice(0, 3).toUpperCase();

/** The flights as boarding-pass tickets, and how the total sits against the budget. */
function tickets(trip, fits) {
  const pct = trip.budget_usd ? Math.min(100, Math.round((trip.total_usd / trip.budget_usd) * 100)) : 100;
  const stays = (trip.stays || []).map((h) => `
    <div class="ticket stay">
      <div class="t-route"><b>🏨</b><span>${esc(String(h.nights))}n</span></div>
      <div class="t-info"><span>${esc(h.name)}</span><small>${esc(h.city)} · ${money(h.price_per_night_usd)} a night</small></div>
      <div class="t-price"><b>${money(h.price_per_night_usd * h.nights)}</b>${/^https?:\/\//.test(h.link) ? `<a href="${esc(h.link)}" target="_blank" rel="noopener noreferrer">View ↗</a>` : ""}</div>
    </div>`).join("");
  const rows = trip.flights.map((f) => `
    <div class="ticket">
      <div class="t-route"><b>${esc(code(f.from))}</b><span class="t-plane">✈</span><b>${esc(code(f.to))}</b></div>
      <div class="t-info"><span>${esc(f.date)} · ${esc(f.airline)}</span><small>${esc(f.from)} → ${esc(f.to)}</small></div>
      <div class="t-price"><b>${money(f.price_usd)}</b>${/^https?:\/\//.test(f.link) ? `<a href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">Book ↗</a>` : ""}</div>
    </div>`).join("");
  return `<div class="trip ${fits ? "fits" : "over"}">
    ${rows || '<p class="muted">No prices found for these flights.</p>'}${stays}
    <div class="meter"><div class="meter-top"><span>${trip.stays?.length ? `Flights ${money(trip.flights_usd ?? trip.total_usd)} + stays ${money(trip.stays_usd || 0)} = <b>${money(trip.total_usd)}</b>` : `Flights ${money(trip.total_usd)}`}</span><span>Budget ${trip.budget_usd ? money(trip.budget_usd) : "?"}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="verdict">${fits ? `🎉 Within budget: ${money(trip.budget_usd - trip.total_usd)} left for the rest` : `😬 Over budget by ${money(trip.total_usd - trip.budget_usd)}`}</div></div>
    ${trip.notes ? `<p class="notes">ℹ️ ${esc(trip.notes)}</p>` : ""}
  </div>`;
}
function setRoute(trip) {
  $("route-from").textContent = trip?.from_city ? code(trip.from_city) : "YOU";
  $("route-to").textContent = trip?.to_city ? code(trip.to_city) : "???";
}

/** Quick replies under an answer: tap to send. */
function chips(el, trip, fits) {
  const list = !trip ? [] : fits
    ? ["📅 Try other dates", "🏨 Find a nicer hotel", "🍽️ Where should I eat?", "➕ Add another city"]
    : [`💰 Raise my budget to $${Math.ceil(trip.total_usd / 50) * 50}`, "📅 Find cheaper dates", "🛫 Try nearby airports", "✂️ Make it shorter"];
  const box = document.createElement("div");
  box.className = "chips";
  for (const c of list) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c;
    b.addEventListener("click", () => send(c.replace(/^\S+\s/, "")));
    box.append(b);
  }
  const share = document.createElement("button");
  share.type = "button"; share.className = "share"; share.textContent = "📤 Share this trip";
  share.addEventListener("click", () => shareTrip(el));
  box.append(share);
  el.append(box);
}
async function shareTrip(el) {
  const text = `${el.innerText.replace(/📤 Share this trip[\s\S]*$/, "").trim()}\n\nPlanned with Tripmate: ${location.origin}`;
  try { if (navigator.share) { await navigator.share({ title: "My Tripmate trip", text }); return; } } catch (e) { if (e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); flash("Copied! Paste it anywhere."); } catch { flash("Couldn't copy on this browser."); }
}
function flash(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- working… ---------- */
let workTimer = null;
function working(on, line) {
  $("working").hidden = !on;
  clearInterval(workTimer);
  if (line) { $("working-line").textContent = line; return; }
  if (on) {
    const lines = ["Reading your trip…", "Searching flights…", "Comparing prices…", "Doing the maths…"];
    let i = 0;
    $("working-line").textContent = lines[0];
    workTimer = setInterval(() => { i = Math.min(i + 1, lines.length - 1); $("working-line").textContent = lines[i]; }, 2500);
  }
}

/* ---------- sending ---------- */
async function send(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  busy = true;
  $("send").disabled = true;
  $("input").value = "";
  grow();
  history.push({ role: "user", content: text });
  save();
  bubble("user", esc(text));
  working(true);
  const answer = bubble("bot", '<div class="searches"></div><div class="body"></div>');
  const body = answer.querySelector(".body"), searches = answer.querySelector(".searches");
  let reply = "", trip = null;
  try {
    controller = new AbortController();
    const r = await fetch("/api/chat", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Couldn't reach Tripmate."); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "status") {
          working(true, ev.text);
          if (ev.text.startsWith("Searched:")) { const s = document.createElement("span"); s.textContent = `🔎 ${ev.text.slice(9).trim()}`; searches.append(s); }
        } else if (ev.type === "trip") {
          trip = ev.trip;
          setRoute(trip);
          answer.insertAdjacentHTML("afterbegin", tickets(trip, ev.fits));
        } else if (ev.type === "delta") {
          working(false);
          reply += ev.text;
          body.innerHTML = markdown(reply);
        } else if (ev.type === "error") {
          throw new Error(ev.text);
        }
        scrollDown();
      }
    }
  } catch (e) {
    body.innerHTML = e.name === "AbortError" ? '<p class="muted">Stopped. Ask again whenever you like.</p>'
      : `<p class="err">${esc(e.message || "Something went wrong.")} Try sending it again.</p>`;
  }
  controller = null;
  working(false);
  if (reply) {
    // keep what the agent found in the conversation, so follow-up questions have it
    const found = trip ? `\n\n(Flights found: ${trip.flights.map((f) => `${f.date} ${f.from}→${f.to} ${f.airline} $${f.price_usd}`).join("; ")}.`
      + `${trip.stays?.length ? ` Stays: ${trip.stays.map((h) => `${h.name} in ${h.city}, ${h.nights} nights at $${h.price_per_night_usd}`).join("; ")}.` : ""} Total $${trip.total_usd}, budget $${trip.budget_usd}.)` : "";
    history.push({ role: "assistant", content: reply + found, trip });
    save();
    chips(answer, trip, trip && trip.budget_usd > 0 && trip.total_usd <= trip.budget_usd);
  } else {
    history.pop();                                                  // nothing came back: let them send it again
    save();
  }
  busy = false;
  $("send").disabled = false;
  if (!matchMedia("(pointer: coarse)").matches) $("input").focus();
}

/* ---------- restoring a conversation ---------- */
function restore() {
  $("msgs").replaceChildren();
  if (!history.length) {
    bubble("bot", markdown("**Hi! I'm Tripmate.** ✈️\nTell me where you're flying from, where to, when, and your budget. I'll search real flights, check the budget, and plan your days (or find a cheaper way).\nOr tap a postcard to try one."));
    return;
  }
  for (const m of history) {
    if (m.role === "user") bubble("user", esc(m.content));
    else {
      const el = bubble("bot", markdown(m.content.replace(/\n\n\(Flights found:[\s\S]*\)$/, "")));
      if (m.trip) { el.insertAdjacentHTML("afterbegin", tickets(m.trip, m.trip.budget_usd > 0 && m.trip.total_usd <= m.trip.budget_usd)); setRoute(m.trip); }
      if (m === history[history.length - 1] && m.trip) chips(el, m.trip, m.trip.budget_usd > 0 && m.trip.total_usd <= m.trip.budget_usd);
    }
  }
}

/* ---------- the take-off screen ---------- */
const TAKEOFF = ["Fastening seatbelts…", "Checking the weather…", "Clearing for take-off…", "Wheels up!"];
let takeoffLine = 0;
const takeoffTimer = setInterval(() => { takeoffLine = (takeoffLine + 1) % TAKEOFF.length; $("takeoff-line").textContent = TAKEOFF[takeoffLine]; }, 700);
setTimeout(() => { clearInterval(takeoffTimer); $("takeoff")?.classList.add("gone"); setTimeout(() => $("takeoff")?.remove(), 800); }, 2600);

/* ---------- postcards, facts, the rotating headline, the clock ---------- */
const POSTCARDS = [
  { city: "Istanbul", emoji: "🕌", tint: "#ffb86b", prompt: "Dammam to Istanbul, then Istanbul to Dubai, then back to Dammam. A week in each city, starting next Sunday. Budget $1,000 for one person." },
  { city: "Dubai", emoji: "🏙️", tint: "#7cc4ff", prompt: "Riyadh to Dubai for a weekend next month, budget $400, one person." },
  { city: "Maldives", emoji: "🏝️", tint: "#5fe0c8", prompt: "From Jeddah, the cheapest beach holiday I can do for 5 days in November with $700." },
  { city: "Paris", emoji: "🗼", tint: "#ff9fb8", prompt: "Riyadh to Paris for 6 days in December, budget $1,200 for one person." },
  { city: "Tokyo", emoji: "🗾", tint: "#c9a7ff", prompt: "Dubai to Tokyo for 10 days in the spring, budget $1,800 for one person." },
  { city: "Surprise me", emoji: "🎲", tint: "#ffe07a", prompt: "Surprise me: the most interesting trip I can do for 5 days from Riyadh next month with $600." },
];
$("postcards").replaceChildren(...POSTCARDS.map((p) => {
  const b = document.createElement("button");
  b.className = "postcard";
  b.type = "button";
  b.style.setProperty("--tint", p.tint);
  b.innerHTML = `<span class="stamp">${p.emoji}</span><b>${esc(p.city)}</b><small>Tap to plan</small>`;
  b.addEventListener("click", () => {
    if (busy) return;
    b.classList.add("sent");
    setTimeout(() => b.classList.remove("sent"), 900);
    if (innerWidth < 900) document.querySelector(".pass").scrollIntoView({ behavior: "smooth" });
    send(p.prompt);
  });
  return b;
}));
const FACTS = [
  "Tuesdays and Wednesdays are often the cheapest days to fly.",
  "Booking about 1 to 3 months ahead usually beats booking last minute.",
  "Nearby airports can be much cheaper: try Bahrain instead of Dammam.",
  "A carry-on-only trip can save you $30 to $70 per flight on budget airlines.",
  "Istanbul has two airports: IST and SAW. Budget airlines love SAW.",
  "The world's shortest scheduled flight lasts about 90 seconds (in Scotland).",
];
let fact = Math.floor(Math.random() * FACTS.length);
const showFact = () => { $("fact").querySelector("span").textContent = FACTS[fact]; fact = (fact + 1) % FACTS.length; };
const WORDS = ["next?", "Istanbul?", "Dubai?", "Paris?", "the beach?", "Tokyo?"];
let word = 0;
function rotate() {
  const el = $("rotator");
  el.classList.add("out");
  setTimeout(() => { word = (word + 1) % WORDS.length; el.textContent = WORDS[word]; el.classList.remove("out"); }, 300);
}
const tickClock = () => { $("clock").textContent = `🕑 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; };

/* ---------- the composer ---------- */
function grow() { const t = $("input"); t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 140)}px`; }
$("input").addEventListener("input", grow);
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send($("input").value); } });
$("composer").addEventListener("submit", (e) => { e.preventDefault(); send($("input").value); });
$("new-chat").addEventListener("click", () => { if (busy) return; history = []; save(); setRoute(null); restore(); $("input").focus(); });
$("stop").addEventListener("click", () => controller?.abort());
function paintCurrency() { $("cur").textContent = currency === "SAR" ? "🇸🇦 SAR" : "🇺🇸 USD"; }
$("cur").addEventListener("click", () => {
  currency = currency === "SAR" ? "USD" : "SAR";
  try { localStorage.setItem("tripmate.cur", currency); } catch { /* ignore */ }
  paintCurrency();
  if (!busy) restore();                                             // redraw the tickets in the new currency
});
paintCurrency();

tickClock(); setInterval(tickClock, 15000);
showFact(); setInterval(showFact, 9000);
setInterval(rotate, 2600);
restore();
