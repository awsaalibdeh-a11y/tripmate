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
  const planned = history.some((m) => m.trip);                     // a question answered about a trip we already found
  const list = trip ? (fits
    ? ["📅 Try other dates", "🏨 Find a nicer hotel", "🍽️ Where should I eat?", "🎒 Packing list"]
    : [`💰 Raise my budget to $${Math.ceil(trip.total_usd / 50) * 50}`, "📅 Find cheaper dates", "🛫 Try nearby airports", "✂️ Make it shorter"])
    : planned ? ["🌦️ What's the weather like?", "🛂 Do I need a visa?", "🚕 How do I get around?", "💬 Useful local phrases"] : [];
  if (!list.length && !trip) return;
  const box = document.createElement("div");
  box.className = "chips";
  for (const c of list) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c;
    b.addEventListener("click", () => send(c.replace(/^\S+\s/, "")));
    box.append(b);
  }
  if (trip) {
    const star = document.createElement("button");
    star.type = "button"; star.className = "save";
    const saved = () => trips.some((t) => t.key === tripKey(trip));
    star.textContent = saved() ? "⭐ Saved" : "☆ Save trip";
    star.addEventListener("click", () => { if (!saved()) saveTrip(trip); star.textContent = "⭐ Saved"; });
    box.append(star);
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
      body: JSON.stringify({ home, messages: history.map(({ role, content }) => ({ role, content })) }) });
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
          if (ev.fits) confetti();
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
  { city: "Istanbul", emoji: "🕌", tint: "#ffb86b", prompt: (h) => `${h} to Istanbul for 5 days next month, with a cheap hotel. Budget $900 for one person.` },
  { city: "Dubai", emoji: "🏙️", tint: "#7cc4ff", prompt: (h) => `${h} to Dubai for a weekend next month, budget $400, one person.` },
  { city: "Maldives", emoji: "🏝️", tint: "#5fe0c8", prompt: (h) => `From ${h}, the cheapest beach holiday I can do for 5 days in November with $700.` },
  { city: "Paris", emoji: "🗼", tint: "#ff9fb8", prompt: (h) => `${h} to Paris for 6 days in December, budget $1,200 for one person.` },
  { city: "Tokyo", emoji: "🗾", tint: "#c9a7ff", prompt: (h) => `${h} to Tokyo for 10 days in the spring, budget $1,800 for one person.` },
  { city: "Surprise me", emoji: "🎲", tint: "#ffe07a", prompt: (h) => `Surprise me: the most interesting trip I can do for 5 days from ${h} next month with $600.` },
];
function renderPostcards() {
 $("postcards").replaceChildren(...POSTCARDS.filter((p) => p.city.toLowerCase() !== homeCity().toLowerCase()).map((p) => {
  const b = document.createElement("button");
  b.className = "postcard";
  b.type = "button";
  b.style.setProperty("--tint", p.tint);
  b.innerHTML = `<span class="stamp">${p.emoji}</span><b>${esc(p.city)}</b><small>Tap to plan</small>`;
  b.addEventListener("click", () => {
    if (busy) return;
    b.classList.add("sent");
    setTimeout(() => b.classList.remove("sent"), 900);
    toChat();
    send(p.prompt(homeCity()));
  });
  return b;
 }));
}
const toChat = () => { if (innerWidth < 900) document.querySelector(".pass").scrollIntoView({ behavior: "smooth" }); };
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
  paintSliders(); paintTrips();
  $("places").replaceChildren();
});
paintCurrency();

/* ---------- home: where trips start ---------- */
// A first guess from the time zone (no permission needed); "Use my location" asks the browser only when tapped.
const TZ_HOME = {
  "Asia/Riyadh": "Riyadh, Saudi Arabia", "Asia/Dubai": "Dubai, UAE", "Asia/Qatar": "Doha, Qatar", "Asia/Bahrain": "Manama, Bahrain",
  "Asia/Kuwait": "Kuwait City, Kuwait", "Asia/Muscat": "Muscat, Oman", "Asia/Amman": "Amman, Jordan", "Asia/Baghdad": "Baghdad, Iraq",
  "Africa/Cairo": "Cairo, Egypt", "Africa/Casablanca": "Casablanca, Morocco", "Europe/Istanbul": "Istanbul, Türkiye", "Asia/Karachi": "Karachi, Pakistan",
  "Asia/Kolkata": "Delhi, India", "Europe/London": "London, UK", "Europe/Paris": "Paris, France", "Europe/Berlin": "Berlin, Germany",
  "America/New_York": "New York, USA", "America/Chicago": "Chicago, USA", "America/Los_Angeles": "Los Angeles, USA", "America/Toronto": "Toronto, Canada",
  "Asia/Tokyo": "Tokyo, Japan", "Asia/Singapore": "Singapore", "Australia/Sydney": "Sydney, Australia",
};
function guessHome() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return TZ_HOME[tz] || (tz.includes("/") ? tz.split("/").pop().replace(/_/g, " ") : "Riyadh, Saudi Arabia");
  } catch { return "Riyadh, Saudi Arabia"; }
}
let home = (() => { try { return localStorage.getItem("tripmate.home") || ""; } catch { return ""; } })() || guessHome();
function homeCity() { return home.split(",")[0].trim(); }
function paintHome() { document.querySelectorAll(".home-city").forEach((el) => { el.textContent = homeCity(); }); }
function setHome(value) {
  value = String(value || "").replace(/[^\p{L}\p{N} ,.'-]/gu, "").trim().slice(0, 60);
  if (!value) return false;
  home = value;
  try { localStorage.setItem("tripmate.home", home); } catch { /* private mode */ }
  paintHome(); renderPostcards();
  $("places").replaceChildren();                                   // old ideas were for the old home
  flash(`📍 Trips now start from ${homeCity()}`);
  return true;
}
$("home-list").replaceChildren(...[...new Set(Object.values(TZ_HOME))].map((v) => Object.assign(document.createElement("option"), { value: v })));
$("home").addEventListener("click", () => { $("home-input").value = home; $("home-sheet").showModal(); });
$("home-cancel").addEventListener("click", () => $("home-sheet").close());
const saveHome = () => { if (setHome($("home-input").value)) $("home-sheet").close(); };
$("home-save").addEventListener("click", saveHome);
$("home-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveHome(); } });
$("home-sheet").addEventListener("click", (e) => { if (e.target === $("home-sheet")) $("home-sheet").close(); });   // tap outside
$("locate").addEventListener("click", () => {
  const btn = $("locate");
  if (!navigator.geolocation) { flash("This browser can't share your location. Type your city instead."); return; }
  btn.disabled = true; btn.textContent = "🎯 Finding you…";
  const done = () => { btn.disabled = false; btn.textContent = "🎯 Use my location"; };
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      // rounded to ~1 km: plenty to name the city, and no exact address leaves the phone
      const lat = pos.coords.latitude.toFixed(2), lon = pos.coords.longitude.toFixed(2);
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const d = await r.json();
      const city = d.city || d.locality || d.principalSubdivision;
      if (!city) throw new Error("no city");
      if (setHome(d.countryName ? `${city}, ${d.countryName}` : city)) $("home-sheet").close();
    } catch { flash("Couldn't work out your city. Type it instead."); }
    done();
  }, () => { flash("Location is off. Type your city instead."); done(); }, { timeout: 12000, maximumAge: 3600000 });
});

/* ---------- tabs: postcards, explore, my trips ---------- */
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
  document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

/* ---------- explore: where can I go from home? ---------- */
const VIBES = ["🏖️ Beach", "🏔️ Nature", "🏙️ City lights", "🕌 History & culture", "🍜 Food", "🎢 Family fun", "🛍️ Shopping", "💆 Relax"];
let vibe = "🏖️ Beach";
$("vibes").replaceChildren(...VIBES.map((v) => {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = v; b.className = v === vibe ? "on" : "";
  b.addEventListener("click", () => { vibe = v; $("vibes").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
  return b;
}));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
$("month").replaceChildren(...Array.from({ length: 12 }, (_, i) => {
  const m = MONTHS[(new Date().getMonth() + i) % 12];
  return Object.assign(document.createElement("option"), { value: m, textContent: i === 0 ? `${m} (this month)` : m });
}));
$("month").selectedIndex = 1;
const paintSliders = () => { $("days-out").textContent = $("days").value; $("budget-out").textContent = money(+$("budget").value); };
$("days").addEventListener("input", paintSliders);
$("budget").addEventListener("input", paintSliders);
paintSliders();

let exploring = false;
$("explore-go").addEventListener("click", async () => {
  if (exploring) return;
  exploring = true;
  const go = $("explore-go"), box = $("places");
  go.disabled = true;
  const globes = ["🌍", "🌎", "🌏"];
  let g = 0;
  const spin = setInterval(() => { g = (g + 1) % 3; go.textContent = `${globes[g]} Spinning the globe…`; }, 350);
  box.replaceChildren(...Array.from({ length: 4 }, () => Object.assign(document.createElement("div"), { className: "place ghost" })));
  const ask = { home, days: +$("days").value, budget: +$("budget").value, vibe: vibe.replace(/^\S+\s/, ""), month: $("month").value };
  try {
    const r = await fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ask) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Couldn't find ideas right now.");
    const places = [...d.places].sort((a, b) => b.domestic - a.domestic);
    box.replaceChildren(...places.map((p, i) => placeCard(p, ask, i)));
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)} Try again.</p>`;
  }
  clearInterval(spin);
  go.disabled = false;
  go.innerHTML = `🧭 Find places near <span class="home-city">${esc(homeCity())}</span>`;
  exploring = false;
});
function placeCard(p, ask, i) {
  const el = document.createElement("article");
  el.className = `place ${p.domestic ? "domestic" : "abroad"}`;
  el.style.animationDelay = `${i * 70}ms`;
  const over = p.est_total_usd > ask.budget;
  const how = p.flight_hours > 0 ? `✈️ ${p.flight_hours < 1 ? "<1" : Math.round(p.flight_hours * 10) / 10}h flight` : "🚗 by road or train";
  el.innerHTML = `
    <div class="p-top"><span class="p-emoji">${esc(p.emoji)}</span><div class="p-name"><b>${esc(p.name)}</b><small>${esc(p.country)}</small></div>
      <span class="badge">${p.domestic ? "🏠 In your country" : "🌍 Nearby abroad"}</span></div>
    <p class="p-why">${esc(p.why)}</p>
    <p class="p-hl">⭐ Don't miss: ${esc(p.highlight)}</p>
    <div class="p-stats"><span>${how}</span><span>📅 Best: ${esc(p.best_months)}</span><span>🛏️ ~${money(p.est_daily_usd)}/day</span></div>
    <div class="p-foot"><div><b class="${over ? "over" : ""}">~${money(p.est_total_usd)}</b><small>${ask.days} days, rough guess</small></div><button type="button">Plan this ✈️</button></div>`;
  el.querySelector("button").addEventListener("click", () => {
    if (busy) return;
    toChat();
    send(`${homeCity()} to ${p.name}, ${p.country} for ${ask.days} days in ${ask.month}, with a cheap place to stay. Budget $${Math.max(ask.budget, Math.ceil(p.est_total_usd / 50) * 50)} for one person.`);
  });
  return el;
}

/* ---------- my trips: saved in this browser, with a countdown ---------- */
const TRIPS = "tripmate.trips";
let trips = (() => { try { return JSON.parse(localStorage.getItem(TRIPS) || "[]"); } catch { return []; } })();
const tripKey = (t) => `${t.from_city}|${t.to_city}|${t.flights?.[0]?.date}|${t.total_usd}`;
function tripDate(t) {
  const raw = t.flights?.[0]?.date;
  if (!raw) return null;
  let d = new Date(raw);
  if (isNaN(d)) d = new Date(`${raw} ${new Date().getFullYear()}`);
  if (isNaN(d)) return null;
  if (d.getFullYear() < 2020) d.setFullYear(new Date().getFullYear());
  return d;
}
function countdown(t) {
  const d = tripDate(t);
  if (!d) return "🗓️ Date to be set";
  const days = Math.ceil((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  return days > 1 ? `⏳ ${days} days to go` : days === 1 ? "🎒 Tomorrow!" : days === 0 ? "✈️ Today!" : "📸 Been there";
}
function persistTrips() { try { localStorage.setItem(TRIPS, JSON.stringify(trips.slice(0, 20))); } catch { /* private mode */ } paintTrips(); }
function saveTrip(trip) {
  trips.unshift({ key: tripKey(trip), trip, chat: history.slice(-20), saved: Date.now() });
  persistTrips();
  flash("⭐ Saved to My trips");
}
function paintTrips() {
  $("trips-n").textContent = trips.length || "";
  const box = $("trips");
  if (!trips.length) {
    box.innerHTML = '<div class="empty"><span>🧳</span><p>No saved trips yet. Plan one and tap <b>☆ Save trip</b> to keep it here with a countdown.</p></div>';
  } else {
    box.replaceChildren(...trips.map((s) => {
      const t = s.trip, el = document.createElement("article");
      el.className = "saved";
      el.innerHTML = `<div class="s-route"><b>${esc(code(t.from_city))}</b><span>✈</span><b>${esc(code(t.to_city))}</b></div>
        <div class="s-info"><b>${esc(t.from_city)} → ${esc(t.to_city)}</b><small>${esc(t.flights?.[0]?.date || "")} · ${money(t.total_usd)}${t.travellers > 1 ? ` · ${t.travellers} people` : ""}</small><span class="s-count">${countdown(t)}</span></div>
        <div class="s-act"><button type="button" class="open">Open</button><button type="button" class="del" aria-label="Remove this trip">🗑️</button></div>`;
      el.querySelector(".open").addEventListener("click", () => {
        if (busy) return;
        history = s.chat.slice(); save(); restore(); toChat();
      });
      el.querySelector(".del").addEventListener("click", () => { trips = trips.filter((x) => x !== s); persistTrips(); });
      return el;
    }));
  }
  // the soonest upcoming trip gets a countdown in the header
  const next = trips.map((s) => ({ s, d: tripDate(s.trip) })).filter((x) => x.d && x.d >= new Date().setHours(0, 0, 0, 0)).sort((a, b) => a.d - b.d)[0];
  $("next-trip").hidden = !next;
  if (next) $("next-trip").textContent = `${countdown(next.s.trip).split(" ")[0]} ${next.s.trip.to_city.split(/[,(]/)[0].trim()}: ${countdown(next.s.trip).replace(/^\S+\s/, "")}`;
}
$("next-trip").addEventListener("click", () => { showTab("trips"); $("tab-trips").scrollIntoView({ behavior: "smooth", block: "center" }); });

/* ---------- confetti when a trip fits the budget ---------- */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = $("confetti"), bits = ["🎉", "✈️", "🌴", "💸", "⭐", "🎈"];
  box.replaceChildren(...Array.from({ length: 28 }, () => {
    const s = document.createElement("span");
    s.textContent = bits[Math.floor(Math.random() * bits.length)];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 0.5}s`;
    s.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
    return s;
  }));
  setTimeout(() => box.replaceChildren(), 3200);
}

paintHome();
renderPostcards();
paintTrips();
tickClock(); setInterval(tickClock, 15000);
showFact(); setInterval(showFact, 9000);
setInterval(rotate, 2600);
restore();
