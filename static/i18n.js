/* Tripmate in English or Arabic. The English text is the key; T() returns the Arabic when the page is in Arabic.
   {name} placeholders are filled from the second argument. Loaded before app.js. */
"use strict";

let lang = (() => {
  try { const saved = localStorage.getItem("tripmate.lang"); if (saved) return saved; } catch { /* private mode */ }
  return /^ar\b/i.test(navigator.language || "") ? "ar" : "en";
})();

const AR = {
  // the page
  "Install": "تثبيت", "New trip": "رحلة جديدة", "Your AI travel buddy": "رفيق سفرك الذكي", "Where to": "إلى أين",
  "lead": 'أخبر Tripmate إلى أين تريد الذهاب ومواعيدك وميزانيتك. يبحث عن رحلات طيران وفنادق حقيقية من <b class="home-city">مدينتك</b>، ويحسب كل شيء، ويخطط أيامك أو يجد لك طريقة أرخص. لا تعرف إلى أين؟ جرّب <b>استكشف</b>.',
  "Postcards": "بطاقات", "Explore near me": "استكشف حولي", "My trips": "رحلاتي", "Tap a postcard to start": "اضغط على بطاقة للبدء",
  "What's the vibe?": "ما الأجواء التي تريدها؟", "Days": "الأيام", "Budget": "الميزانية", "When": "متى", "Did you know?": "هل تعلم؟",
  "Boarding pass": "بطاقة صعود", "Gate": "البوابة", "Stop": "إيقاف",
  "From where, to where, when, and your budget…": "من أين، إلى أين، متى، وكم ميزانيتك…",
  "Prices are estimates from the web: always check before you book.": "الأسعار تقديرية من الإنترنت: تأكد دائمًا قبل الحجز.",
  "Where do you live?": "أين تسكن؟",
  "Your trips start here, and Explore suggests places inside your country and nearby. It stays in this browser.": "رحلاتك تبدأ من هنا، ويقترح «استكشف» أماكن داخل بلدك وقريبة منه. يبقى ذلك في هذا المتصفح فقط.",
  "or type your city": "أو اكتب مدينتك", "e.g. Jeddah, Saudi Arabia": "مثال: Jeddah, Saudi Arabia", "Cancel": "إلغاء", "Save": "حفظ",
  "YOU": "أنت",

  // chat
  "welcome": "**أهلًا! أنا Tripmate.** ✈️\nأخبرني من أين ستسافر، وإلى أين، ومتى، وكم ميزانيتك. سأبحث عن رحلات حقيقية، وأتحقق من الميزانية، وأخطط أيامك (أو أجد لك طريقة أرخص).\nأو اضغط على بطاقة لتجرّب.",
  "Reading your trip…": "أقرأ تفاصيل رحلتك…", "Searching flights…": "أبحث عن رحلات…", "Comparing prices…": "أقارن الأسعار…", "Doing the maths…": "أحسب التكاليف…",
  "Thinking…": "أفكر…", "Writing your plan…": "أكتب خطتك…", "Finding cheaper options…": "أبحث عن خيارات أرخص…",
  "Fastening seatbelts…": "اربط حزام الأمان…", "Checking the weather…": "أتحقق من الطقس…", "Clearing for take-off…": "استعداد للإقلاع…", "Wheels up!": "أقلعنا!",
  "Couldn't reach Tripmate.": "تعذّر الوصول إلى Tripmate.", "Stopped. Ask again whenever you like.": "تم الإيقاف. اسأل مجددًا متى شئت.",
  "Something went wrong.": "حدث خطأ ما.", "Try sending it again.": "حاول الإرسال مرة أخرى.",

  // tickets and budget
  "{n}n": "{n} ليالٍ", "{p} a night": "{p} لليلة", "View ↗": "عرض ↗", "Book ↗": "احجز ↗",
  "No prices found for these flights.": "لم نجد أسعارًا لهذه الرحلات.",
  "Flights {a} + stays {b} = <b>{c}</b>": "الطيران {a} + الإقامة {b} = <b>{c}</b>", "Flights {a}": "الطيران {a}", "Budget {b}": "الميزانية {b}",
  "🎉 Within budget: {x} left for the rest": "🎉 ضمن الميزانية: يتبقى {x} لباقي الرحلة", "😬 Over budget by {x}": "😬 تتجاوز الميزانية بـ {x}",
  "👥 Split between": "👥 قسّمها على", "= {x} each": "= {x} للشخص",

  // quick replies (sent to the agent as the traveller's message)
  "📅 Try other dates": "📅 جرّب تواريخ أخرى", "🏨 Find a nicer hotel": "🏨 ابحث عن فندق أفضل", "🍽️ Where should I eat?": "🍽️ أين آكل؟",
  "🎒 Packing list": "🎒 قائمة التجهيز", "💰 Raise my budget to ${x}": "💰 ارفع ميزانيتي إلى {x} دولار", "📅 Find cheaper dates": "📅 ابحث عن تواريخ أرخص",
  "🛫 Try nearby airports": "🛫 جرّب مطارات قريبة", "✂️ Make it shorter": "✂️ اجعلها أقصر", "🌦️ What's the weather like?": "🌦️ كيف الطقس هناك؟",
  "🛂 Do I need a visa?": "🛂 هل أحتاج تأشيرة؟", "🚕 How do I get around?": "🚕 كيف أتنقل هناك؟", "💬 Useful local phrases": "💬 عبارات محلية مفيدة",
  "⭐ Saved": "⭐ محفوظة", "☆ Save trip": "☆ احفظ الرحلة", "📤 Share this trip": "📤 شارك الرحلة", "🗺️ Plan it from {c}": "🗺️ خطط لها من {c}",
  "Copied! Paste it anywhere.": "تم النسخ! الصقه في أي مكان.", "Couldn't copy on this browser.": "تعذّر النسخ في هذا المتصفح.",
  "My trip: {a} → {b}, {t}. Open it here:": "رحلتي: {a} ← {b}، {t}. افتحها هنا:",
  "🎁 A friend shared this trip with you. Want it from your city? Tap below.": "🎁 شاركك صديق هذه الرحلة. تريدها من مدينتك؟ اضغط بالأسفل.",
  "That trip link looks broken.": "يبدو أن رابط الرحلة لا يعمل.",
  "{a} to {b} on similar dates, budget ${x} for one person.": "من {a} إلى {b} في تواريخ مشابهة، بميزانية {x} دولار لشخص واحد.",

  // home, location
  "📍 Trips now start from {c}": "📍 رحلاتك تبدأ الآن من {c}", "🎯 Use my location": "🎯 استخدم موقعي", "🎯 Finding you…": "🎯 أحدد موقعك…",
  "This browser can't share your location. Type your city instead.": "هذا المتصفح لا يشارك موقعك. اكتب مدينتك بدلًا من ذلك.",
  "Couldn't work out your city. Type it instead.": "لم نتمكن من معرفة مدينتك. اكتبها بدلًا من ذلك.",
  "Location is off. Type your city instead.": "الموقع مغلق. اكتب مدينتك بدلًا من ذلك.",

  // postcards, facts, headline
  "Tap to plan": "اضغط للتخطيط", "Istanbul": "إسطنبول", "Dubai": "دبي", "Maldives": "المالديف", "Paris": "باريس", "Tokyo": "طوكيو", "Surprise me": "فاجئني",
  "next?": "التالي؟", "Istanbul?": "إسطنبول؟", "Dubai?": "دبي؟", "Paris?": "باريس؟", "the beach?": "البحر؟", "Tokyo?": "طوكيو؟",
  "Tuesdays and Wednesdays are often the cheapest days to fly.": "الثلاثاء والأربعاء غالبًا أرخص أيام الطيران.",
  "Booking about 1 to 3 months ahead usually beats booking last minute.": "الحجز قبل شهر إلى ثلاثة أشهر أوفر عادةً من الحجز في آخر لحظة.",
  "Nearby airports can be much cheaper: try Bahrain instead of Dammam.": "المطارات القريبة قد تكون أرخص بكثير: جرّب البحرين بدل الدمام.",
  "A carry-on-only trip can save you $30 to $70 per flight on budget airlines.": "السفر بحقيبة يد فقط يوفر 30 إلى 70 دولارًا لكل رحلة على الطيران الاقتصادي.",
  "Istanbul has two airports: IST and SAW. Budget airlines love SAW.": "لإسطنبول مطاران: IST وSAW. شركات الطيران الاقتصادي تفضّل SAW.",
  "The world's shortest scheduled flight lasts about 90 seconds (in Scotland).": "أقصر رحلة طيران مجدولة في العالم مدتها نحو 90 ثانية (في اسكتلندا).",

  // explore
  "Beach": "شاطئ", "Nature": "طبيعة", "City lights": "أضواء المدينة", "History & culture": "تاريخ وثقافة", "Food": "أكل", "Family fun": "مرح عائلي",
  "Shopping": "تسوق", "Relax": "استرخاء", "(this month)": "(هذا الشهر)",
  "🧭 Find places near {c}": "🧭 ابحث عن أماكن قرب {c}", "Spinning the globe…": "ندوّر الكرة الأرضية…",
  "Couldn't find ideas right now.": "لم نجد أفكارًا الآن.", "Try again.": "حاول مجددًا.",
  "✈️ {h}h flight": "✈️ رحلة {h} ساعة", "🚗 by road or train": "🚗 بالسيارة أو القطار", "🏠 In your country": "🏠 داخل بلدك", "🌍 Nearby abroad": "🌍 قريب في الخارج",
  "⭐ Don't miss: {x}": "⭐ لا تفوّت: {x}", "📅 Best: {x}": "📅 أفضل وقت: {x}", "🛏️ ~{x}/day": "🛏️ ~{x} لليوم", "{d} days, rough guess": "{d} أيام، تقدير تقريبي",
  "Plan this ✈️": "خطط لها ✈️",
  "{h} to {p}, {c} for {d} days in {m}, with a cheap place to stay. Budget ${b} for one person.": "من {h} إلى {p}، {c} لمدة {d} أيام في شهر {m}، مع مكان إقامة رخيص. الميزانية {b} دولار لشخص واحد.",

  // my trips
  "🗓️ Date to be set": "🗓️ التاريخ لم يحدد", "⏳ {n} days to go": "⏳ باقي {n} يوم", "🎒 Tomorrow!": "🎒 غدًا!", "✈️ Today!": "✈️ اليوم!", "📸 Been there": "📸 زرتها",
  "{n} people": "{n} أشخاص", "Open": "فتح", "⭐ Saved to My trips": "⭐ حُفظت في رحلاتي",
  "empty-trips": 'لا توجد رحلات محفوظة بعد. خطط لرحلة واضغط <b>☆ احفظ الرحلة</b> لتبقى هنا مع عدّ تنازلي.',
  "These flights don't have dates yet.": "هذه الرحلات ليس لها تواريخ بعد.", "📅 Open the file to add it to your calendar": "📅 افتح الملف لإضافتها إلى تقويمك",

  // passport and badges
  "🛂 My travel passport": "🛂 جواز سفري", "{n} stamps · {b}/{t} badges": "{n} أختام · {b}/{t} شارات", "Plan a trip to get your first stamp.": "خطط لرحلة لتحصل على أول ختم.",
  "{i} Badge unlocked: {n}!": "{i} حصلت على شارة: {n}!",
  "First trip": "أول رحلة", "Plan your first trip": "خطط لأول رحلة", "Budget hero": "بطل الميزانية", "Find a trip within budget": "اعثر على رحلة ضمن الميزانية",
  "Explorer": "مستكشف", "Plan 3 different places": "خطط لـ 3 أماكن مختلفة", "Globetrotter": "رحّالة", "Plan 7 different places": "خطط لـ 7 أماكن مختلفة",
  "Scout": "كشّاف", "Find ideas with Explore": "اعثر على أفكار من «استكشف»", "Collector": "جامع الرحلات", "Save a trip": "احفظ رحلة",
  "Quiz whiz": "عبقري المسابقة", "Score 3/3 or better in the waiting game": "أجب 3 من 3 أو أكثر في لعبة الانتظار",
  "Packed & ready": "جاهز للسفر", "Tick off a whole packing list": "أكمل قائمة التجهيز كاملة",

  // destination
  "🌍 Checking the weather there…": "🌍 أتحقق من الطقس هناك…", "🕐 {t} there": "🕐 {t} هناك", "({h}h ahead of you)": "(متقدم عنك {h} ساعة)",
  "({h}h behind you)": "(متأخر عنك {h} ساعة)", "(same time as you)": "(نفس توقيتك)", "{t}°C now": "{t}° الآن",
  "🌍 {k} km": "🌍 {k} كم", "⏱️ ~{t} in the air": "⏱️ ~{t} في الجو", "🌱 ~{c} kg CO₂ each": "🌱 ~{c} كغ CO₂ للشخص",
  "💵 1 {a} = {x} there": "💵 1 {a} = {x} هناك", "💵 about {x} a day to spend there": "💵 حوالي {x} يوميًا للصرف هناك",
  "🕌 Prayer times there today": "🕌 مواقيت الصلاة هناك اليوم", "Fajr": "الفجر", "Dhuhr": "الظهر", "Asr": "العصر", "Maghrib": "المغرب", "Isha": "العشاء",

  // packing
  "🎒 Packing list for {d} days": "🎒 قائمة التجهيز لـ {d} أيام", "Based on this week's weather there.": "حسب طقس هذا الأسبوع هناك.",
  "🛂 Passport / ID": "🛂 الجواز / الهوية", "🎫 Tickets & hotel booking (screenshots too)": "🎫 التذاكر وحجز الفندق (وصور منها)",
  "💳 Card + a little local cash": "💳 بطاقة + قليل من النقد المحلي", "🔌 Charger + power bank": "🔌 شاحن + باور بانك", "🔌 Plug adapter": "🔌 محوّل كهرباء",
  "💊 Medicines": "💊 الأدوية", "👕 {n} tops": "👕 {n} قمصان", "👖 {n} trousers / skirts": "👖 {n} بناطيل / تنانير", "🧦 {n} socks & underwear": "🧦 {n} جوارب وملابس داخلية",
  "😴 Sleepwear": "😴 ملابس نوم", "🪥 Toothbrush & toiletries": "🪥 فرشاة أسنان وأدوات العناية", "👟 Comfy walking shoes": "👟 حذاء مريح للمشي",
  "🧴 Sunscreen": "🧴 واقي شمس", "🕶️ Sunglasses": "🕶️ نظارة شمسية", "🧢 Hat": "🧢 قبعة", "💧 Refillable water bottle": "💧 قارورة ماء",
  "🧥 Warm jacket": "🧥 جاكيت دافئ", "🧣 Scarf & a warm layer": "🧣 وشاح وطبقة دافئة", "☂️ Umbrella or rain jacket": "☂️ مظلة أو معطف مطر",
  "🧺 Laundry bag": "🧺 كيس غسيل", "🎧 Headphones for the flight": "🎧 سماعات للرحلة",

  // quiz
  "🎮 While I search: which country?": "🎮 أثناء البحث: أي دولة؟", "🏆 Perfect! {r}/{a} countries": "🏆 ممتاز! {r}/{a} دول",
  "🎮 You got {r}/{a}. Your trip's ready!": "🎮 أصبت {r}/{a}. رحلتك جاهزة!",
  "France": "فرنسا", "Italy": "إيطاليا", "USA": "أمريكا", "Japan": "اليابان", "Saudi Arabia": "السعودية", "UAE": "الإمارات", "Australia": "أستراليا",
  "Mexico": "المكسيك", "UK": "بريطانيا", "Germany": "ألمانيا", "China": "الصين", "India": "الهند", "Brazil": "البرازيل", "Canada": "كندا",
  "Türkiye": "تركيا", "Egypt": "مصر", "Netherlands": "هولندا", "Spain": "إسبانيا", "Peru": "بيرو", "Vietnam": "فيتنام", "Thailand": "تايلاند",
  "New Zealand": "نيوزيلندا", "Switzerland": "سويسرا", "Iceland": "آيسلندا", "Jordan": "الأردن", "Kenya": "كينيا", "Greece": "اليونان",
  "Argentina": "الأرجنتين", "South Korea": "كوريا الجنوبية", "Morocco": "المغرب", "Austria": "النمسا",

  // app, voice
  "Allow the microphone to talk to Tripmate.": "اسمح باستخدام الميكروفون للتحدث مع Tripmate.", "📲 Tripmate is on your home screen!": "📲 أصبح Tripmate على شاشتك الرئيسية!",
};

// Long English texts that are looked up by a short key.
const EN = {
  "welcome": "**Hi! I'm Tripmate.** ✈️\nTell me where you're flying from, where to, when, and your budget. I'll search real flights, check the budget, and plan your days (or find a cheaper way).\nOr tap a postcard to try one.",
  "empty-trips": "No saved trips yet. Plan one and tap <b>☆ Save trip</b> to keep it here with a countdown.",
};

function T(s, vars) {
  let out = lang === "ar" && AR[s] !== undefined ? AR[s] : EN[s] !== undefined ? EN[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return out;
}

/** Translate the fixed parts of the page: [data-i18n] text (or a named key) and [data-i18n-ph] placeholders. */
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.dataset.en === undefined) el.dataset.en = el.innerHTML.trim();
    const key = el.dataset.i18n || el.dataset.en;
    el.innerHTML = lang === "ar" && AR[key] !== undefined ? AR[key] : el.dataset.en;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    if (el.dataset.en === undefined) el.dataset.en = el.placeholder;
    el.placeholder = T(el.dataset.en);
  });
  const btn = document.getElementById("lang");
  if (btn) btn.textContent = lang === "ar" ? "EN" : "ع";
}
applyLang();
