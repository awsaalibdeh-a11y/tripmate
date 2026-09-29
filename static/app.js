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
// The agent works in US dollars; the page shows any currency. Gulf pegs until live rates arrive from our server.
let rates = { USD: 1, SAR: 3.75, AED: 3.6725, QAR: 3.64, KWD: 0.307, BHD: 0.376, OMR: 0.3845, JOD: 0.709 };
let PICK = Object.keys(rates);                                     // the currencies offered in the menu
let currency = (() => { try { return localStorage.getItem("tripmate.cur") || ""; } catch { return ""; } })();
function money(n) {
  const cur = rates[currency] ? currency : "USD";
  const v = n * rates[cur];
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(v); }
  catch { return `${Math.round(v).toLocaleString("en")} ${cur}`; }
}
const code = (place) => (/\(([A-Z]{3})\)/.exec(place || "") || [])[1] || String(place || "").slice(0, 3).toUpperCase();

/** The flights as boarding-pass tickets, and how the total sits against the budget. */
function tickets(trip, fits) {
  const pct = trip.budget_usd ? Math.min(100, Math.round((trip.total_usd / trip.budget_usd) * 100)) : 100;
  const stays = (trip.stays || []).map((h) => `
    <div class="ticket stay">
      <div class="t-route"><b>🏨</b><span>${T("{n}n", { n: esc(String(h.nights)) })}</span></div>
      <div class="t-info"><span>${esc(h.name)}</span><small>${esc(h.city)} · ${T("{p} a night", { p: money(h.price_per_night_usd) })}</small></div>
      <div class="t-price"><b>${money(h.price_per_night_usd * h.nights)}</b>${/^https?:\/\//.test(h.link) ? `<a href="${esc(h.link)}" target="_blank" rel="noopener noreferrer">${T("View ↗")}</a>` : ""}</div>
    </div>`).join("");
  const rows = trip.flights.map((f) => `
    <div class="ticket">
      <div class="t-route"><b>${esc(code(f.from))}</b><span class="t-plane">✈</span><b>${esc(code(f.to))}</b></div>
      <div class="t-info"><span>${esc(f.date)} · ${esc(f.airline)}</span><small>${esc(f.from)} → ${esc(f.to)}</small></div>
      <div class="t-price"><b>${money(f.price_usd)}</b>${/^https?:\/\//.test(f.link) ? `<a href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">${T("Book ↗")}</a>` : ""}</div>
    </div>`).join("");
  const legs = (trip.flights || []).map((f) => [cityName(f.from), cityName(f.to)]).filter(([a, b]) => a && b);
  return `<div class="trip ${fits ? "fits" : "over"}">
    ${legs.length ? `<div class="map" data-legs="${esc(JSON.stringify(legs))}"></div>` : ""}
    ${rows || `<p class="muted">${T("No prices found for these flights.")}</p>`}${stays}
    <div class="meter"><div class="meter-top"><span>${trip.stays?.length ? T("Flights {a} + stays {b} = <b>{c}</b>", { a: money(trip.flights_usd ?? trip.total_usd), b: money(trip.stays_usd || 0), c: money(trip.total_usd) }) : T("Flights {a}", { a: money(trip.total_usd) })}</span><span>${T("Budget {b}", { b: trip.budget_usd ? money(trip.budget_usd) : "?" })}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="verdict">${fits ? T("🎉 Within budget: {x} left for the rest", { x: money(trip.budget_usd - trip.total_usd) }) : T("😬 Over budget by {x}", { x: money(trip.total_usd - trip.budget_usd) })}</div>
      <div class="split" data-total="${Number(trip.total_usd) || 0}" data-n="${Math.max(1, trip.travellers || 1)}">${T("👥 Split between")}
        <button type="button" data-d="-1" aria-label="Fewer people">−</button><b>${Math.max(1, trip.travellers || 1)}</b><button type="button" data-d="1" aria-label="More people">+</button>
        <span>${T("= {x} each", { x: money((Number(trip.total_usd) || 0) / Math.max(1, trip.travellers || 1)) })}</span></div></div>
    ${trip.to_city ? `<div class="dest" data-city="${esc(cityName(trip.to_city))}" data-days="${tripDays(trip)}" data-key="${esc(tripKey(trip))}" data-left="${fits ? Math.max(0, trip.budget_usd - trip.total_usd) : 0}"></div>` : ""}
    ${trip.notes ? `<p class="notes">ℹ️ ${esc(trip.notes)}</p>` : ""}
  </div>`;
}
function setRoute(trip) {
  $("route-from").textContent = trip?.from_city ? code(trip.from_city) : T("YOU");
  $("route-to").textContent = trip?.to_city ? code(trip.to_city) : "???";
}

/** Quick replies under an answer: tap to send. */
function chips(el, trip, fits) {
  const planned = history.some((m) => m.trip);                     // a question answered about a trip we already found
  const list = (trip ? (fits
    ? ["📅 Try other dates", "🏨 Find a nicer hotel", "🍽️ Where should I eat?", "🎒 Packing list"]
    : ["💰 Raise my budget to ${x}", "📅 Find cheaper dates", "🛫 Try nearby airports", "✂️ Make it shorter"])
    : planned ? ["🌦️ What's the weather like?", "🛂 Do I need a visa?", "🚕 How do I get around?", "💬 Useful local phrases"] : [])
    .map((c) => T(c, { x: Math.ceil((trip?.total_usd || 0) / 50) * 50 }).replace("${x}", `$${Math.ceil((trip?.total_usd || 0) / 50) * 50}`));
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
    star.textContent = saved() ? T("⭐ Saved") : T("☆ Save trip");
    star.addEventListener("click", () => { if (!saved()) saveTrip(trip); star.textContent = T("⭐ Saved"); });
    box.append(star);
  }
  const share = document.createElement("button");
  share.type = "button"; share.className = "share"; share.textContent = T("📤 Share this trip");
  share.addEventListener("click", () => shareTrip(el, trip));
  box.append(share);
  el.append(box);
}
/** Share a trip as a link: the whole trip rides in the link itself (after the #), so no server storage is needed. */
async function shareTrip(el, trip) {
  let text, url = location.origin;
  if (trip) {
    const packed64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(trip)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    url = `${location.origin}/#t=${packed64}`;
    text = T("My trip: {a} → {b}, {t}. Open it here:", { a: cityName(trip.from_city), b: cityName(trip.to_city), t: money(trip.total_usd) });
  } else {
    text = el.innerText.trim().slice(0, 600);
  }
  try { if (navigator.share) { await navigator.share({ title: "Tripmate", text, url }); return; } } catch (e) { if (e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); flash(T("Copied! Paste it anywhere.")); } catch { flash(T("Couldn't copy on this browser.")); }
}
function flash(msg) {
  let stack = document.querySelector(".toasts");
  if (!stack) { stack = Object.assign(document.createElement("div"), { className: "toasts" }); document.body.append(stack); }
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  stack.append(t);
  setTimeout(() => t.remove(), 3000);
}

/* ---------- working… ---------- */
let workTimer = null;
function working(on, line) {
  $("working").hidden = !on;
  clearInterval(workTimer);
  if (line) { $("working-line").textContent = line; return; }
  if (on) {
    const lines = ["Reading your trip…", "Searching flights…", "Comparing prices…", "Doing the maths…"].map((x) => T(x));
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
  const quizTimer = setTimeout(() => startQuiz(answer), 5000);        // a long search? play a game meanwhile
  let reply = "", trip = null;
  try {
    controller = new AbortController();
    const r = await fetch("/api/chat", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home, lang, messages: history.map(({ role, content }) => ({ role, content })) }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || T("Couldn't reach Tripmate.")); }
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
          working(true, ev.text.startsWith("Searched:") ? `🔎 ${ev.text.slice(9).trim()}` : T(ev.text));
          if (ev.text.startsWith("Searched:")) { const s = document.createElement("span"); s.textContent = `🔎 ${ev.text.slice(9).trim()}`; searches.append(s); }
        } else if (ev.type === "trip") {
          trip = ev.trip;
          setRoute(trip);
          endQuiz();
          answer.insertAdjacentHTML("afterbegin", tickets(trip, ev.fits));
          fillDest(answer);
          addStamp(trip, ev.fits);
          if (ev.fits) confetti();
        } else if (ev.type === "delta") {
          endQuiz();
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
    body.innerHTML = e.name === "AbortError" ? `<p class="muted">${T("Stopped. Ask again whenever you like.")}</p>`
      : `<p class="err">${esc(e.message || T("Something went wrong."))} ${T("Try sending it again.")}</p>`;
  }
  controller = null;
  clearTimeout(quizTimer);
  endQuiz();
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
    bubble("bot", markdown(T("welcome")));
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
  fillDest($("msgs"));
}

/* ---------- the take-off screen ---------- */
const TAKEOFF = ["Fastening seatbelts…", "Checking the weather…", "Clearing for take-off…", "Wheels up!"].map((x) => T(x));
$("takeoff-line").textContent = TAKEOFF[0];
let takeoffLine = 0;
const takeoffTimer = setInterval(() => { takeoffLine = (takeoffLine + 1) % TAKEOFF.length; $("takeoff-line").textContent = TAKEOFF[takeoffLine]; }, 700);
setTimeout(() => { clearInterval(takeoffTimer); $("takeoff")?.classList.add("gone"); setTimeout(() => $("takeoff")?.remove(), 800); }, 2600);

/* ---------- postcards, facts, the rotating headline, the clock ---------- */
const POSTCARDS = [
  { city: "Istanbul", emoji: "🕌", tint: "#ffb86b", prompt: (h) => `${h} to Istanbul for 5 days next month, with a cheap hotel. Budget $900 for one person.`, ar: (h) => `من ${h} إلى إسطنبول لمدة 5 أيام الشهر القادم مع فندق رخيص. الميزانية 900 دولار لشخص واحد.` },
  { city: "Dubai", emoji: "🏙️", tint: "#7cc4ff", prompt: (h) => `${h} to Dubai for a weekend next month, budget $400, one person.`, ar: (h) => `من ${h} إلى دبي لعطلة نهاية أسبوع الشهر القادم، الميزانية 400 دولار لشخص واحد.` },
  { city: "Maldives", emoji: "🏝️", tint: "#5fe0c8", prompt: (h) => `From ${h}, the cheapest beach holiday I can do for 5 days in November with $700.`, ar: (h) => `من ${h}، أرخص عطلة بحرية لمدة 5 أيام في نوفمبر بميزانية 700 دولار.` },
  { city: "Paris", emoji: "🗼", tint: "#ff9fb8", prompt: (h) => `${h} to Paris for 6 days in December, budget $1,200 for one person.`, ar: (h) => `من ${h} إلى باريس لمدة 6 أيام في ديسمبر، الميزانية 1200 دولار لشخص واحد.` },
  { city: "Tokyo", emoji: "🗾", tint: "#c9a7ff", prompt: (h) => `${h} to Tokyo for 10 days in the spring, budget $1,800 for one person.`, ar: (h) => `من ${h} إلى طوكيو لمدة 10 أيام في الربيع، الميزانية 1800 دولار لشخص واحد.` },
  { city: "Surprise me", emoji: "🎲", tint: "#ffe07a", prompt: (h) => `Surprise me: the most interesting trip I can do for 5 days from ${h} next month with $600.`, ar: (h) => `فاجئني: أكثر رحلة ممتعة لمدة 5 أيام من ${h} الشهر القادم بميزانية 600 دولار.` },
];
function renderPostcards() {
 $("postcards").replaceChildren(...POSTCARDS.filter((p) => p.city.toLowerCase() !== homeCity().toLowerCase()).map((p) => {
  const b = document.createElement("button");
  b.className = "postcard";
  b.type = "button";
  b.style.setProperty("--tint", p.tint);
  b.innerHTML = `<span class="stamp">${p.emoji}</span><b>${esc(T(p.city))}</b><small>${T("Tap to plan")}</small>`;
  b.addEventListener("click", () => {
    if (busy) return;
    b.classList.add("sent");
    setTimeout(() => b.classList.remove("sent"), 900);
    toChat();
    send((lang === "ar" ? p.ar : p.prompt)(homeCity()));
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
const showFact = () => { $("fact").querySelector(".fact-text").textContent = T(FACTS[fact]); fact = (fact + 1) % FACTS.length; };
const WORDS = ["next?", "Istanbul?", "Dubai?", "Paris?", "the beach?", "Tokyo?"];
let word = 0;
function rotate() {
  const el = $("rotator");
  el.classList.add("out");
  setTimeout(() => { word = (word + 1) % WORDS.length; el.textContent = T(WORDS[word]); el.classList.remove("out"); }, 300);
}
const tickClock = () => { $("clock").textContent = `🕑 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; };

/* ---------- the composer ---------- */
function grow() { const t = $("input"); t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 140)}px`; }
$("input").addEventListener("input", grow);
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send($("input").value); } });
$("composer").addEventListener("submit", (e) => { e.preventDefault(); send($("input").value); });
$("new-chat").addEventListener("click", () => { if (busy) return; history = []; save(); setRoute(null); restore(); $("input").focus(); });
$("stop").addEventListener("click", () => controller?.abort());
function paintCurrency() {
  $("cur").replaceChildren(...PICK.filter((c) => rates[c]).map((c) => Object.assign(document.createElement("option"), { value: c, textContent: c })));
  $("cur").value = rates[currency] ? currency : "USD";
}
function useCurrency(c, remember) {
  currency = c;
  if (remember) { try { localStorage.setItem("tripmate.cur", c); } catch { /* ignore */ } }
  paintCurrency();
  if (!busy) restore();                                             // redraw the tickets in the new currency
  paintSliders(); paintTrips();
  $("places").replaceChildren();
}
$("cur").addEventListener("change", () => useCurrency($("cur").value, true));

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
function homeCity() { return home.split(/[,،]/)[0].trim(); }
function paintHome() { document.querySelectorAll(".home-city").forEach((el) => { el.textContent = homeCity(); }); }
function setHome(value) {
  value = String(value || "").replace(/[^\p{L}\p{N} ,.'-]/gu, "").trim().slice(0, 60);
  if (!value) return false;
  home = value;
  try { localStorage.setItem("tripmate.home", home); } catch { /* private mode */ }
  paintHome(); renderPostcards();
  $("places").replaceChildren();                                   // old ideas were for the old home
  let chosen = ""; try { chosen = localStorage.getItem("tripmate.cur") || ""; } catch { /* private mode */ }
  if (!chosen) useCurrency(homeCurrency(), false);
  flash(T("📍 Trips now start from {c}", { c: homeCity() }));
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
  if (!navigator.geolocation) { flash(T("This browser can't share your location. Type your city instead.")); return; }
  btn.disabled = true; btn.textContent = T("🎯 Finding you…");
  const done = () => { btn.disabled = false; btn.textContent = T("🎯 Use my location"); };
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      // rounded to ~1 km: plenty to name the city, and no exact address leaves the phone
      const lat = pos.coords.latitude.toFixed(2), lon = pos.coords.longitude.toFixed(2);
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const d = await r.json();
      const city = d.city || d.locality || d.principalSubdivision;
      if (!city) throw new Error("no city");
      if (setHome(d.countryName ? `${city}, ${d.countryName}` : city)) $("home-sheet").close();
    } catch { flash(T("Couldn't work out your city. Type it instead.")); }
    done();
  }, () => { flash(T("Location is off. Type your city instead.")); done(); }, { timeout: 12000, maximumAge: 3600000 });
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
const vibeLabel = (v) => v.replace(/^(\S+)\s(.*)$/, (m, e, n) => `${e} ${T(n)}`);
function renderVibes() {
  $("vibes").replaceChildren(...VIBES.map((v) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = vibeLabel(v); b.className = v === vibe ? "on" : "";
    b.addEventListener("click", () => { vibe = v; $("vibes").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    return b;
  }));
}
renderVibes();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function renderMonths() {
  const keep = $("month").selectedIndex;
  $("month").replaceChildren(...Array.from({ length: 12 }, (_, i) => {
    const n = (new Date().getMonth() + i) % 12, m = MONTHS[n];
    const label = new Date(2026, n, 1).toLocaleString(lang === "ar" ? "ar" : "en", { month: "long" });
    return Object.assign(document.createElement("option"), { value: m, textContent: i === 0 ? `${label} ${T("(this month)")}` : label });
  }));
  $("month").selectedIndex = keep > 0 ? keep : 1;
}
renderMonths();
const paintGo = () => { $("explore-go").innerHTML = T("🧭 Find places near {c}", { c: `<span class="home-city">${esc(homeCity())}</span>` }); };
paintGo();
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
  const spin = setInterval(() => { g = (g + 1) % 3; go.textContent = `${globes[g]} ${T("Spinning the globe…")}`; }, 350);
  box.replaceChildren(...Array.from({ length: 4 }, () => Object.assign(document.createElement("div"), { className: "place ghost" })));
  const ask = { home, lang, days: +$("days").value, budget: +$("budget").value, vibe: vibe.replace(/^\S+\s/, ""), month: $("month").value };
  try {
    const r = await fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ask) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || T("Couldn't find ideas right now."));
    const places = [...d.places].sort((a, b) => b.domestic - a.domestic);
    box.replaceChildren(...places.map((p, i) => placeCard(p, ask, i)));
    award("scout");
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)} ${T("Try again.")}</p>`;
  }
  clearInterval(spin);
  go.disabled = false;
  paintGo();
  exploring = false;
});
function placeCard(p, ask, i) {
  const el = document.createElement("article");
  el.className = `place ${p.domestic ? "domestic" : "abroad"}`;
  el.style.animationDelay = `${i * 70}ms`;
  const over = p.est_total_usd > ask.budget;
  const how = p.flight_hours > 0 ? T("✈️ {h}h flight", { h: p.flight_hours < 1 ? "<1" : Math.round(p.flight_hours * 10) / 10 }) : T("🚗 by road or train");
  el.innerHTML = `
    <div class="p-photo"></div>
    <div class="p-top"><span class="p-emoji">${esc(p.emoji)}</span><div class="p-name"><b>${esc(p.name)}</b><small>${esc(p.country)}</small></div>
      <span class="badge">${p.domestic ? T("🏠 In your country") : T("🌍 Nearby abroad")}</span></div>
    <p class="p-why">${esc(p.why)}</p>
    <p class="p-hl">${T("⭐ Don't miss: {x}", { x: esc(p.highlight) })}</p>
    <div class="p-stats"><span>${how}</span><span>${T("📅 Best: {x}", { x: esc(p.best_months) })}</span><span>${T("🛏️ ~{x}/day", { x: money(p.est_daily_usd) })}</span></div>
    <div class="p-foot"><div><b class="${over ? "over" : ""}">~${money(p.est_total_usd)}</b><small>${T("{d} days, rough guess", { d: ask.days })}</small></div><button type="button">${T("Plan this ✈️")}</button></div>`;
  wiki(p.name).then((info) => photo(el.querySelector(".p-photo"), info));
  el.querySelector("button").addEventListener("click", () => {
    if (busy) return;
    toChat();
    send(T("{h} to {p}, {c} for {d} days in {m}, with a cheap place to stay. Budget ${b} for one person.",
      { h: homeCity(), p: p.name, c: p.country, d: ask.days, m: $("month").selectedOptions[0]?.textContent.replace(/\s*\(.*\)$/, "") || ask.month, b: Math.max(ask.budget, Math.ceil(p.est_total_usd / 50) * 50) })
      .replace("${b}", `$${Math.max(ask.budget, Math.ceil(p.est_total_usd / 50) * 50)}`));
  });
  return el;
}

/* ---------- my trips: saved in this browser, with a countdown ---------- */
const TRIPS = "tripmate.trips";
let trips = (() => { try { return JSON.parse(localStorage.getItem(TRIPS) || "[]"); } catch { return []; } })();
const tripKey = (t) => `${t.from_city}|${t.to_city}|${t.flights?.[0]?.date}|${t.total_usd}`;
function tripDate(t) { return parseDate(t.flights?.[0]?.date); }
function parseDate(raw) {
  if (!raw) return null;
  let d = new Date(raw);
  if (isNaN(d)) d = new Date(`${raw} ${new Date().getFullYear()}`);
  if (isNaN(d)) return null;
  if (d.getFullYear() < 2020) d.setFullYear(new Date().getFullYear());
  return d;
}
function countdown(t) {
  const d = tripDate(t);
  if (!d) return T("🗓️ Date to be set");
  const days = Math.ceil((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  return days > 1 ? T("⏳ {n} days to go", { n: days }) : days === 1 ? T("🎒 Tomorrow!") : days === 0 ? T("✈️ Today!") : T("📸 Been there");
}
function persistTrips() { try { localStorage.setItem(TRIPS, JSON.stringify(trips.slice(0, 20))); } catch { /* private mode */ } paintTrips(); }
function saveTrip(trip) {
  trips.unshift({ key: tripKey(trip), trip, chat: history.slice(-20), saved: Date.now() });
  persistTrips();
  flash(T("⭐ Saved to My trips"));
  award("saver");
}
function paintTrips() {
  $("trips-n").textContent = trips.length || "";
  const box = $("trips");
  if (!trips.length) {
    box.innerHTML = `<div class="empty"><span>🧳</span><p>${T("empty-trips")}</p></div>`;
  } else {
    box.replaceChildren(...trips.map((s) => {
      const t = s.trip, el = document.createElement("article");
      el.className = "saved";
      el.innerHTML = `<div class="s-route"><b>${esc(code(t.from_city))}</b><span>✈</span><b>${esc(code(t.to_city))}</b></div>
        <div class="s-info"><b>${esc(t.from_city)} → ${esc(t.to_city)}</b><small>${esc(t.flights?.[0]?.date || "")} · ${money(t.total_usd)}${t.travellers > 1 ? ` · ${T("{n} people", { n: t.travellers })}` : ""}</small><span class="s-count">${countdown(t)}</span></div>
        <div class="s-act"><button type="button" class="open">${T("Open")}</button><button type="button" class="cal" aria-label="Add the flights to my calendar" title="Add to calendar">📅</button><button type="button" class="del" aria-label="Remove this trip">🗑️</button></div>`;
      el.querySelector(".cal").addEventListener("click", () => calendar(s));
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

/* ---------- currency: live rates, and a sensible default for where you live ---------- */
const COUNTRY_CUR = {
  "saudi arabia": "SAR", uae: "AED", "united arab emirates": "AED", qatar: "QAR", kuwait: "KWD", bahrain: "BHD", oman: "OMR",
  egypt: "EGP", jordan: "JOD", "türkiye": "TRY", turkey: "TRY", uk: "GBP", "united kingdom": "GBP", india: "INR", pakistan: "PKR",
  france: "EUR", germany: "EUR", spain: "EUR", italy: "EUR", netherlands: "EUR", ireland: "EUR", portugal: "EUR", austria: "EUR", belgium: "EUR",
  "السعودية": "SAR", "المملكة العربية السعودية": "SAR", "الإمارات": "AED", "قطر": "QAR", "الكويت": "KWD", "البحرين": "BHD", "عمان": "OMR", "عُمان": "OMR",
  "مصر": "EGP", "الأردن": "JOD", "تركيا": "TRY",
};
function homeCurrency() { return COUNTRY_CUR[(home.split(/[,،]/)[1] || home).trim().toLowerCase()] || "USD"; }
if (!currency) currency = homeCurrency();
paintCurrency();
fetch("/api/rates").then((r) => r.json()).then((d) => {
  if (!d.rates?.USD) return;
  rates = d.rates;
  if (Array.isArray(d.pick)) PICK = d.pick;
  paintCurrency(); paintSliders(); paintTrips();
  if (currency !== "USD" && !busy) restore();
}).catch(() => { /* the pegs are fine */ });

/* ---------- the destination: weather this week and local time (Open-Meteo, free and keyless) ---------- */
function cityName(place) { return String(place || "").split(/[,(]/)[0].trim(); }
const WX = (c) => (c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "❄️" : c <= 82 ? "🌦️" : "⛈️");
const destCache = {};
const geoCache = {};
function geocode(city) {
  geoCache[city] ??= fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`)
    .then((r) => r.json()).then((g) => g.results?.[0] || null).catch(() => null);
  return geoCache[city];
}
function destInfo(city) {
  destCache[city] ??= (async () => {
    const p = await geocode(city);
    if (!p) return null;
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}`
      + "&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6")).json();
    return { name: p.name, country: p.country || "", code: p.country_code || "", lat: p.latitude, lon: p.longitude, tz: p.timezone, w };
  })().catch(() => null);
  return destCache[city];
}
function hoursApart(tz) {
  const now = new Date();
  const there = new Date(now.toLocaleString("en-US", { timeZone: tz })), here = new Date(now.toLocaleString("en-US"));
  return Math.round(((there - here) / 36e5) * 2) / 2;
}
async function fillDest(root) {
  fillMaps(root);
  for (const el of root.querySelectorAll(".dest:empty")) {
    el.innerHTML = `<span class="muted">${T("🌍 Checking the weather there…")}</span>`;
    const d = await destInfo(el.dataset.city);
    if (!d?.w?.daily) { el.remove(); continue; }
    const diff = hoursApart(d.tz);
    const time = new Date().toLocaleTimeString("en", { timeZone: d.tz, hour: "2-digit", minute: "2-digit" });
    const days = d.w.daily.time.map((t, i) => `<span><small>${new Date(`${t}T12:00`).toLocaleDateString(lang === "ar" ? "ar" : "en", { weekday: "short" })}</small>${WX(d.w.daily.weather_code[i])}<b>${Math.round(d.w.daily.temperature_2m_max[i])}°</b><small>${Math.round(d.w.daily.temperature_2m_min[i])}°</small></span>`).join("");
    el.innerHTML = `<div class="d-head"><b>📍 ${esc(d.name)}</b>${d.country ? `, ${esc(d.country)}` : ""}
      <span>${T("🕐 {t} there", { t: time })} ${diff ? T(diff > 0 ? "({h}h ahead of you)" : "({h}h behind you)", { h: Math.abs(diff) }) : T("(same time as you)")}</span>
      <span>${WX(d.w.current.weather_code)} ${T("{t}°C now", { t: Math.round(d.w.current.temperature_2m) })}</span></div>
      <div class="d-days" title="This week's forecast">${days}</div><div class="d-money"></div><div class="d-pray"></div><div class="d-pack"></div>`;
    localMoney(el.querySelector(".d-money"), d.code, +el.dataset.left || 0, +el.dataset.days || 5);
    prayerTimes(el.querySelector(".d-pray"), d);
    fillPacking(el.querySelector(".d-pack"), el.dataset.key, +el.dataset.days || 5, d.w.daily);
    const banner = document.createElement("a");
    banner.className = "d-photo"; banner.target = "_blank"; banner.rel = "noopener noreferrer";
    el.prepend(banner);
    wiki(el.dataset.city).then((info) => {
      if (info?.url) banner.href = info.url;
      if (info?.text) banner.innerHTML = `<span>${esc(info.text)}</span>`;
      photo(banner, info);
    });
  }
}

/* ---------- the route map: a little plane flies your trip (Leaflet + OpenStreetMap tiles, loaded only when needed) ---------- */
let leaflet = null;
function loadLeaflet() {
  leaflet ??= new Promise((ok, fail) => {
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" }));
    document.head.append(Object.assign(document.createElement("script"), { src: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js", onload: () => ok(window.L), onerror: fail }));
  });
  return leaflet;
}
const rad = (d) => (d * Math.PI) / 180;
function km([a, b], [c, d]) {
  const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** A gentle arc from A to B, like a flight path on a map. */
function arc(A, B, steps = 40) {
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], dx = B[1] - A[1], dy = B[0] - A[0];
  const ctrl = [mid[0] + dx * 0.18, mid[1] - dy * 0.18];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return [u * u * A[0] + 2 * u * t * ctrl[0] + t * t * B[0], u * u * A[1] + 2 * u * t * ctrl[1] + t * t * B[1]];
  });
}
const hrs = (h) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`;
async function fillMaps(root) {
  const els = [...root.querySelectorAll(".map:not([data-done])")];
  if (!els.length) return;
  els.forEach((el) => { el.dataset.done = "1"; });
  let L;
  try { L = await loadLeaflet(); } catch { els.forEach((el) => el.remove()); return; }
  for (const el of els) {
    const legs = JSON.parse(el.dataset.legs || "[]");
    const names = [...new Set(legs.flat())];
    const pts = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await geocode(n)])));
    const good = legs.filter(([a, b]) => pts[a] && pts[b] && a !== b);
    if (!good.length || !el.isConnected) { el.remove(); continue; }
    const at = (n) => [pts[n].latitude, pts[n].longitude];
    const map = L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !matchMedia("(pointer: coarse)").matches, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 12 }).addTo(map);
    let dist = 0;
    const path = [];
    for (const [a, b] of good) {
      dist += km(at(a), at(b));
      const line = arc(at(a), at(b));
      path.push(...line);
      L.polyline(line, { color: "#2b7fff", weight: 3, dashArray: "6 8", opacity: 0.9 }).addTo(map);
    }
    for (const n of names) if (pts[n]) L.marker(at(n), { icon: L.divIcon({ className: "pin", html: `<span>${esc(n)}</span>`, iconSize: null }) }).addTo(map);
    map.fitBounds(L.latLngBounds(path), { padding: [30, 30] });
    setTimeout(() => map.invalidateSize(), 50);
    const plane = L.marker(path[0], { icon: L.divIcon({ className: "plane-pin", html: "<span>✈️</span>", iconSize: [26, 26] }), interactive: false }).addTo(map);
    let i = 0;
    const fly = setInterval(() => {
      if (!el.isConnected) { clearInterval(fly); map.remove(); return; }
      i = (i + 1) % (path.length + 15);                               // a short pause at the end, then again
      const p = path[Math.min(i, path.length - 1)], q = path[Math.min(i + 1, path.length - 1)];
      plane.setLatLng(p);
      const a = map.latLngToLayerPoint(p), b = map.latLngToLayerPoint(q);
      if (a.distanceTo(b) > 0.5) plane.getElement().firstChild.style.transform = `rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 45}deg)`;
    }, 80);
    el.insertAdjacentHTML("afterend", `<div class="route-stats"><span>${T("🌍 {k} km", { k: Math.round(dist).toLocaleString("en") })}</span><span>${T("⏱️ ~{t} in the air", { t: hrs(dist / 800 + 0.5 * good.length) })}</span><span>${T("🌱 ~{c} kg CO₂ each", { c: Math.round(dist * 0.1) })}</span></div>`);
  }
}

/* ---------- photos and a line about each place (Wikipedia's free summary API) ---------- */
const wikiCache = {};
function wiki(place) {
  const title = String(place).split(/[,(&/]| and /)[0].trim();
  if (!title) return Promise.resolve(null);
  wikiCache[title] ??= fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.type !== "disambiguation" && d.thumbnail ? {
      img: d.originalimage && d.originalimage.width <= 1600 ? d.originalimage.source : d.thumbnail.source,
      text: (d.extract || "").split(/(?<=\.)\s/)[0], url: d.content_urls?.desktop?.page,
    } : null))
    .catch(() => null);
  return wikiCache[title];
}
function photo(el, info) {
  if (!info?.img) { el.remove(); return; }
  const img = new Image();
  img.onload = () => { el.style.backgroundImage = `url("${encodeURI(decodeURI(info.img))}")`; el.classList.add("loaded"); };
  img.onerror = () => el.remove();
  img.src = info.img;
}

/* ---------- packing list: built from the trip length and this week's weather there ---------- */
const PACK = "tripmate.pack";
let packed = (() => { try { return JSON.parse(localStorage.getItem(PACK) || "{}"); } catch { return {}; } })();
function tripDays(trip) {
  const dates = (trip.flights || []).map((f) => parseDate(f.date)).filter(Boolean);
  if (dates.length > 1) return Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / 864e5));
  const nights = (trip.stays || []).reduce((n, s) => n + (+s.nights || 0), 0);
  return nights || 5;
}
function packingList(days, w) {
  const hot = w && Math.max(...w.temperature_2m_max) >= 28, cold = w && Math.min(...w.temperature_2m_min) <= 12;
  const wet = w && w.weather_code.some((c) => (c >= 51 && c <= 82) || c >= 95);
  const d = Math.min(days, 7);
  const counted = [["👕 {n} tops", d], ["👖 {n} trousers / skirts", Math.ceil(d / 2)], ["🧦 {n} socks & underwear", Math.min(days + 1, 8)]];
  return [
    "🛂 Passport / ID", "🎫 Tickets & hotel booking (screenshots too)", "💳 Card + a little local cash", "🔌 Charger + power bank", "🔌 Plug adapter",
    "💊 Medicines", ...counted, "😴 Sleepwear", "🪥 Toothbrush & toiletries", "👟 Comfy walking shoes",
    ...(hot ? ["🧴 Sunscreen", "🕶️ Sunglasses", "🧢 Hat", "💧 Refillable water bottle"] : []),
    ...(cold ? ["🧥 Warm jacket", "🧣 Scarf & a warm layer"] : []),
    ...(wet ? ["☂️ Umbrella or rain jacket"] : []),
    ...(days >= 5 ? ["🧺 Laundry bag"] : []), "🎧 Headphones for the flight",
  ].map((x) => (Array.isArray(x) ? { id: x[0].replace("{n}", x[1]), label: T(x[0], { n: x[1] }) } : { id: x, label: T(x) }));
}
function fillPacking(box, key, days, w) {
  const items = packingList(days, w), done = new Set(packed[key] || []);
  const count = () => `${items.filter((x) => done.has(x.id)).length}/${items.length}`;
  box.innerHTML = `<details class="pack"><summary>${T("🎒 Packing list for {d} days", { d: days })} <b>${count()}</b></summary><div class="pack-items"></div><small class="muted">${T("Based on this week's weather there.")}</small></details>`;
  box.querySelector(".pack-items").replaceChildren(...items.map((x) => {
    const l = document.createElement("label");
    const c = Object.assign(document.createElement("input"), { type: "checkbox", checked: done.has(x.id) });
    c.addEventListener("change", () => {
      c.checked ? done.add(x.id) : done.delete(x.id);
      packed[key] = [...done];
      try { localStorage.setItem(PACK, JSON.stringify(packed)); } catch { /* private mode */ }
      box.querySelector("summary b").textContent = count();
      if (items.every((y) => done.has(y.id))) { confetti(); award("packer"); }
    });
    l.append(c, document.createTextNode(` ${x.label}`));
    return l;
  }));
}

/* ---------- the travel passport: a stamp for every place you plan, and badges to unlock ---------- */
const BADGES = {
  first: ["🥇", "First trip", "Plan your first trip"], budget: ["💸", "Budget hero", "Find a trip within budget"],
  explorer: ["🧭", "Explorer", "Plan 3 different places"], globe: ["🌍", "Globetrotter", "Plan 7 different places"],
  scout: ["🔭", "Scout", "Find ideas with Explore"], saver: ["⭐", "Collector", "Save a trip"],
  quiz: ["🧠", "Quiz whiz", "Score 3/3 or better in the waiting game"], packer: ["🎒", "Packed & ready", "Tick off a whole packing list"],
};
const STAMP_COLORS = ["#e2445c", "#2b7fff", "#1d8a52", "#9a5b00", "#7b4bd6", "#d9480f"];
let passport = (() => { try { return JSON.parse(localStorage.getItem("tripmate.passport") || "") || null; } catch { return null; } })() || { stamps: [], badges: {} };
const keepPassport = () => { try { localStorage.setItem("tripmate.passport", JSON.stringify(passport)); } catch { /* private mode */ } paintPassport(); };
function award(id) {
  if (passport.badges[id] || !BADGES[id]) return;
  passport.badges[id] = Date.now();
  keepPassport();
  flash(T("{i} Badge unlocked: {n}!", { i: BADGES[id][0], n: T(BADGES[id][1]) }));
}
function addStamp(trip, fits) {
  const city = cityName(trip.to_city);
  if (city && !passport.stamps.some((s) => s.city === city)) passport.stamps.push({ city, code: code(trip.to_city), at: Date.now() });
  keepPassport();
  award("first");
  if (fits) award("budget");
  if (passport.stamps.length >= 3) award("explorer");
  if (passport.stamps.length >= 7) award("globe");
}
function paintPassport() {
  const box = $("passport");
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const got = Object.keys(passport.badges).length;
  box.innerHTML = `<div class="pp-head"><b>${T("🛂 My travel passport")}</b><small>${T("{n} stamps · {b}/{t} badges", { n: passport.stamps.length, b: got, t: Object.keys(BADGES).length })}</small></div>
    <div class="stamps">${passport.stamps.length ? passport.stamps.map((s) => {
      const h = Math.abs(hash(s.city));
      return `<span class="stamp-ink" style="--c:${STAMP_COLORS[h % STAMP_COLORS.length]};--r:${(h % 25) - 12}deg"><b>${esc(s.code)}</b><small>${esc(s.city)}</small><i>${new Date(s.at).toLocaleDateString("en", { month: "short", year: "2-digit" })}</i></span>`;
    }).join("") : `<p class="muted">${T("Plan a trip to get your first stamp.")}</p>`}</div>
    <div class="badges">${Object.entries(BADGES).map(([id, [icon, name, how]]) => `<span class="badge-${passport.badges[id] ? "on" : "off"}" title="${esc(T(how))}"><i>${icon}</i><b>${esc(T(name))}</b><small>${esc(T(how))}</small></span>`).join("")}</div>`;
}

/* ---------- split the cost ---------- */
$("msgs").addEventListener("click", (e) => {
  const b = e.target.closest(".split button");
  if (!b) return;
  const box = b.closest(".split");
  const n = Math.max(1, Math.min(20, +box.dataset.n + +b.dataset.d));
  box.dataset.n = n;
  box.querySelector("b").textContent = n;
  box.querySelector("span").textContent = T("= {x} each", { x: money(+box.dataset.total / n) });
});

/* ---------- a game while the agent searches: guess the country from three emoji ---------- */
const QUIZ = [
  ["🗼🥐🧀", "France"], ["🍕🛵🏛️", "Italy"], ["🗽🍔🚕", "USA"], ["🍣🗻🌸", "Japan"], ["🐪🕋🌴", "Saudi Arabia"], ["🏙️🏎️🛍️", "UAE"],
  ["🐨🦘🏄", "Australia"], ["🌮🌵🎺", "Mexico"], ["🫖💂🎡", "UK"], ["🥨🍺🏰", "Germany"], ["🐼🥟🧧", "China"], ["🍛🐘🕌", "India"],
  ["⚽🎭🏖️", "Brazil"], ["🍁🏒🐻", "Canada"], ["🧿☕🎈", "Türkiye"], ["🐫🏺🔺", "Egypt"], ["🌷🚲🧀", "Netherlands"], ["💃🥘☀️", "Spain"],
  ["🦙⛰️🏚️", "Peru"], ["🍜🏍️🌾", "Vietnam"], ["🐘🛕🥭", "Thailand"], ["🥝🐑⛰️", "New Zealand"], ["🏔️🧀⌚", "Switzerland"],
  ["🌋🌊🐴", "Iceland"], ["🏜️🌹🏛️", "Jordan"], ["🦁🌅🦒", "Kenya"], ["🏛️🫒⛵", "Greece"], ["🧉⚽🥩", "Argentina"], ["📱🥢🎤", "South Korea"],
  ["🏝️🐢🤿", "Maldives"], ["☕🕌🎶", "Morocco"], ["🏰🦌🎻", "Austria"],
];
let quiz = null;
function startQuiz(answer) {
  if (quiz || !busy || answer.querySelector(".trip") || answer.querySelector(".body").textContent) return;
  quiz = { el: document.createElement("div"), right: 0, asked: 0 };
  quiz.el.className = "quiz";
  answer.querySelector(".searches").after(quiz.el);
  nextQuestion();
}
function nextQuestion() {
  if (!quiz) return;
  const [clue, country] = QUIZ[Math.floor(Math.random() * QUIZ.length)];
  const others = QUIZ.map((q) => q[1]).filter((c) => c !== country).sort(() => Math.random() - 0.5).slice(0, 2);
  const options = [country, ...others].sort(() => Math.random() - 0.5);
  quiz.el.innerHTML = `<div class="q-top"><span>${T("🎮 While I search: which country?")}</span><b>${quiz.right}/${quiz.asked}</b></div><div class="q-clue">${clue}</div><div class="q-opts"></div>`;
  quiz.el.querySelector(".q-opts").replaceChildren(...options.map((o) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = T(o); b.dataset.id = o;
    b.addEventListener("click", () => {
      if (!quiz || quiz.el.classList.contains("locked")) return;
      quiz.el.classList.add("locked");
      quiz.asked += 1;
      if (o === country) quiz.right += 1;
      quiz.el.querySelectorAll(".q-opts button").forEach((x) => x.classList.add(x.dataset.id === country ? "yes" : x === b ? "no" : "dim"));
      quiz.el.querySelector(".q-top b").textContent = `${quiz.right}/${quiz.asked}`;
      setTimeout(() => { quiz?.el.classList.remove("locked"); nextQuestion(); }, 1000);
    });
    return b;
  }));
}
function endQuiz() {
  if (!quiz) return;
  const { el, right, asked } = quiz;
  quiz = null;
  el.remove();
  if (asked >= 3 && right === asked) award("quiz");
  if (asked) flash(T(right === asked ? "🏆 Perfect! {r}/{a} countries" : "🎮 You got {r}/{a}. Your trip's ready!", { r: right, a: asked }));
}

/* ---------- speak your trip (browser speech recognition, where supported) ---------- */
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Speech) {
  $("mic").hidden = false;
  let rec = null;
  $("mic").addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new Speech();
    rec.lang = lang === "ar" ? "ar-SA" : navigator.language || "en-US";
    rec.interimResults = true;
    const before = $("input").value.trim();
    rec.onresult = (e) => { $("input").value = `${before} ${[...e.results].map((r) => r[0].transcript).join("")}`.trim(); grow(); };
    rec.onerror = (e) => { if (e.error === "not-allowed") flash(T("Allow the microphone to talk to Tripmate.")); };
    rec.onend = () => { rec = null; $("mic").classList.remove("on"); $("input").focus(); };
    rec.start();
    $("mic").classList.add("on");
  });
}

/* ---------- add the flights to a calendar (.ics works with Google, Apple and Outlook) ---------- */
function calendar(s) {
  const t = s.trip, ics = (x) => String(x).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const events = t.flights.map((f, i) => {
    const d = parseDate(f.date);
    if (!d) return "";
    const next = new Date(d); next.setDate(d.getDate() + 1);
    return ["BEGIN:VEVENT", `UID:${s.saved}-${i}@tripmate`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(next)}`,
      `SUMMARY:${ics(`✈️ ${cityName(f.from)} → ${cityName(f.to)} (${f.airline})`)}`,
      `DESCRIPTION:${ics(`${f.from} → ${f.to}, about $${f.price_usd}. ${f.link || ""}\nPlanned with Tripmate.`)}`, "END:VEVENT"].join("\r\n");
  }).filter(Boolean);
  if (!events.length) { flash(T("These flights don't have dates yet.")); return; }
  const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tripmate//EN", ...events, "END:VCALENDAR"].join("\r\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/calendar" })), download: `tripmate-${cityName(t.to_city).toLowerCase().replace(/\W+/g, "-")}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  flash(T("📅 Open the file to add it to your calendar"));
}

/* ---------- day and night: the sky follows your clock (tap the clock to switch) ---------- */
const hour = new Date().getHours();
document.body.classList.toggle("night", hour >= 19 || hour < 6);
$("clock").addEventListener("click", () => document.body.classList.toggle("night"));

/* ---------- surprise me: spin the vibes, pick days and a month, then explore ---------- */
$("surprise").addEventListener("click", () => {
  if (exploring) return;
  const chipsEls = [...$("vibes").querySelectorAll("button")];
  const pick = Math.floor(Math.random() * chipsEls.length);
  $("surprise").classList.add("rolling");
  let i = 0;
  const spin = setInterval(() => {
    chipsEls.forEach((c, j) => c.classList.toggle("on", j === i % chipsEls.length));
    i += 1;
    if (i > chipsEls.length * 2 + pick) {
      clearInterval(spin);
      chipsEls[pick].click();
      $("days").value = 3 + Math.floor(Math.random() * 5);
      $("month").selectedIndex = 1 + Math.floor(Math.random() * 3);
      paintSliders();
      $("surprise").classList.remove("rolling");
      $("explore-go").click();
    }
  }, 70);
});

/* ---------- money there: the local currency, and what's left of the budget per day ---------- */
const CC_CUR = {
  SA: "SAR", AE: "AED", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR", EG: "EGP", JO: "JOD", TR: "TRY", GB: "GBP", IN: "INR", PK: "PKR",
  US: "USD", JP: "JPY", CN: "CNY", HK: "HKD", TW: "TWD", KR: "KRW", TH: "THB", MY: "MYR", ID: "IDR", SG: "SGD", PH: "PHP", VN: "VND",
  MV: "MVR", LK: "LKR", NP: "NPR", BD: "BDT", MA: "MAD", TN: "TND", DZ: "DZD", LB: "LBP", IQ: "IQD", GE: "GEL", AZ: "AZN", AM: "AMD",
  UZ: "UZS", KZ: "KZT", CH: "CHF", CZ: "CZK", HU: "HUF", PL: "PLN", RO: "RON", BG: "BGN", RS: "RSD", BA: "BAM", AL: "ALL", SE: "SEK",
  NO: "NOK", DK: "DKK", IS: "ISK", AU: "AUD", NZ: "NZD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", ZA: "ZAR", KE: "KES", TZ: "TZS",
  ...Object.fromEntries("FR DE ES IT NL IE PT AT BE GR FI HR SK SI LU MT CY EE LV LT ME".split(" ").map((c) => [c, "EUR"])),
};
function inCurrency(usd, cur) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(usd * rates[cur]); }
  catch { return `${Math.round(usd * rates[cur]).toLocaleString("en")} ${cur}`; }
}
function localMoney(box, country, leftUsd, days) {
  const cur = CC_CUR[country];
  if (!cur || !rates[cur] || !rates[currency]) { box.remove(); return; }
  const parts = [];
  if (cur !== currency) {
    const one = rates[cur] / rates[currency];
    parts.push(T("💵 1 {a} = {x} there", { a: currency, x: `${one >= 10 ? Math.round(one).toLocaleString("en") : one.toFixed(2)} ${cur}` }));
  }
  if (leftUsd > 0) parts.push(T("💵 about {x} a day to spend there", { x: inCurrency(leftUsd / Math.max(1, days), cur) }));
  if (!parts.length) { box.remove(); return; }
  box.innerHTML = parts.map((x) => `<span>${esc(x)}</span>`).join("");
}

/* ---------- prayer times at the destination today (AlAdhan, free and keyless; Umm al-Qura method) ---------- */
async function prayerTimes(box, d) {
  try {
    const day = new Date().toLocaleDateString("en-GB", { timeZone: d.tz }).split("/").join("-");
    const r = await fetch(`https://api.aladhan.com/v1/timings/${day}?latitude=${d.lat}&longitude=${d.lon}&method=4`);
    const t = (await r.json()).data.timings;
    box.innerHTML = `<b>${T("🕌 Prayer times there today")}</b>${["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map((n) => `<span><small>${T(n)}</small>${esc(String(t[n]).slice(0, 5))}</span>`).join("")}`;
  } catch { box.remove(); }
}

/* ---------- a trip someone shared: the link carries it after #t= ---------- */
function sharedTrip() {
  const m = /^#t=([\w-]+)$/.exec(location.hash);
  if (!m) return;
  window.history.replaceState(null, "", location.pathname);        // a refresh shouldn't add it twice
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    const str = (v) => String(v ?? "").slice(0, 200), num = (v) => (Number.isFinite(+v) ? +v : 0);
    const trip = {
      ready: true, question: "", from_city: str(raw.from_city), to_city: str(raw.to_city), travellers: Math.max(1, num(raw.travellers)),
      budget_usd: num(raw.budget_usd), total_usd: num(raw.total_usd), flights_usd: num(raw.flights_usd), stays_usd: num(raw.stays_usd), notes: str(raw.notes),
      flights: (Array.isArray(raw.flights) ? raw.flights : []).slice(0, 8).map((f) => ({ date: str(f.date), from: str(f.from), to: str(f.to), airline: str(f.airline), price_usd: num(f.price_usd), link: str(f.link) })),
      stays: (Array.isArray(raw.stays) ? raw.stays : []).slice(0, 8).map((h) => ({ city: str(h.city), nights: num(h.nights), name: str(h.name), price_per_night_usd: num(h.price_per_night_usd), link: str(h.link) })),
    };
    if (!trip.flights.length) throw new Error("empty");
    const fits = trip.budget_usd > 0 && trip.total_usd <= trip.budget_usd;
    const found = `\n\n(Flights found: ${trip.flights.map((f) => `${f.date} ${f.from}→${f.to} ${f.airline} $${f.price_usd}`).join("; ")}. Total $${trip.total_usd}, budget $${trip.budget_usd}.)`;
    history.push({ role: "assistant", content: T("🎁 A friend shared this trip with you. Want it from your city? Tap below.") + found, trip });
    save();
    restore();
    const last = $("msgs").lastElementChild;
    const again = document.createElement("button");
    again.type = "button";
    again.textContent = T("🗺️ Plan it from {c}", { c: homeCity() });
    again.addEventListener("click", () => send(T("{a} to {b} on similar dates, budget ${x} for one person.", { a: homeCity(), b: cityName(trip.to_city), x: Math.ceil(trip.total_usd / 50) * 50 })
      .replace("${x}", `$${Math.ceil(trip.total_usd / 50) * 50}`)));
    last.querySelector(".chips")?.prepend(again);
    setRoute(trip);
    toChat();
    if (fits) confetti();
  } catch { flash(T("That trip link looks broken.")); }
}

/* ---------- English / Arabic ---------- */
function relabel() {
  applyLang();
  paintHome(); renderPostcards(); renderVibes(); renderMonths(); paintGo(); paintTrips(); paintPassport(); showFact();
  $("rotator").textContent = T(WORDS[word]);
  $("locate").textContent = T("🎯 Use my location");
  setRoute(history.filter((m) => m.trip).pop()?.trip);
  if (!busy) restore();
}
$("lang").addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  try { localStorage.setItem("tripmate.lang", lang); } catch { /* private mode */ }
  relabel();
});

/* ---------- install as an app (Chrome/Edge/Android offer it; the page works offline for saved trips) ---------- */
let installEvent = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; $("install").hidden = false; });
$("install").addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  $("install").hidden = true;
});
addEventListener("appinstalled", () => { $("install").hidden = true; flash(T("📲 Tripmate is on your home screen!")); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* not critical */ });

paintHome();
renderPostcards();
paintTrips();
paintPassport();
$("rotator").textContent = T(WORDS[0]);
$("locate").textContent = T("🎯 Use my location");
tickClock(); setInterval(tickClock, 15000);
showFact(); setInterval(showFact, 9000);
setInterval(rotate, 2600);
restore();
sharedTrip();
