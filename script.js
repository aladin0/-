// app.js — واجهة تفاعلية لجلب مواقيت ونظام جدولة إشعارات/أوامر
// يعتمد على Aladhan API: https://api.aladhan.com/v1/timingsByCity?city=...&country=...

const getBtn = document.getElementById('getBtn');
const cityInput = document.getElementById('city');
const countryInput = document.getElementById('country');
const todayCard = document.getElementById('todayCard');
const tbody = document.querySelector('#timesTable tbody');
const statusEl = document.getElementById('status');
const requestNotBtn = document.getElementById('requestNot');
const openDndBtn = document.getElementById('openDnd');

let scheduled = {}; // key -> { timeoutId, fireAt, config }
const STORAGE_KEY = 'silent_prayer_settings_v1';

// افتراضي للقوائم
const defaultConfig = {
  Fajr: { enabled: true, delay: 10, duration: 10 },
  Dhuhr: { enabled: true, delay: 10, duration: 10 },
  Asr: { enabled: true, delay: 10, duration: 10 },
  Maghrib: { enabled: true, delay: 5, duration: 10 }, // مغرب 5 دقائق قبل التفعيل حسب طلبك
  Isha: { enabled: true, delay: 10, duration: 10 }
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(defaultConfig));
    const parsed = JSON.parse(raw);
    // merge with defaults to ensure keys exist
    return { ...defaultConfig, ...parsed };
  } catch (e) {
    return JSON.parse(JSON.stringify(defaultConfig));
  }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

let cfg = loadConfig();

// طلب إذن الإشعارات
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('المتصفح لا يدعم إشعارات سطح المكتب/الموبايل.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

requestNotBtn.addEventListener('click', async () => {
  const ok = await requestNotificationPermission();
  alert(ok ? 'إذن الإشعارات مُنح' : 'لم تُمنح إذن الإشعارات');
});

// محاولة فتح إعدادات DND (Chrome for Android يدعم intent)
openDndBtn.addEventListener('click', () => {
  const intent = "intent:#Intent;action=android.settings.ZEN_MODE_SETTINGS;end";
  try { window.location = intent; }
  catch(e){ alert('افتح إعدادات الهاتف > الصوت > عدم الإزعاج يدوياً'); }
});

// تحويل "HH:mm" إلى Date لليوم الحالي
function hhmmToDate(hhmm) {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// جلب مواقيت اليوم من Aladhan
async function fetchTimings(city, country) {
  const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=2`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('فشل جلب المواقيت: ' + resp.status);
  const j = await resp.json();
  if (!j || !j.data || !j.data.timings) throw new Error('بيانات غير متوقعة من API');
  // نأخذ الحقول المطلوبة فقط
  const t = j.data.timings;
  // إزالة القيم غير مرغوب فيها (مثلاً "Sunrise" إلخ)
  const out = {
    Fajr: t.Fajr.split(' ')[0].slice(0,5),
    Dhuhr: t.Dhuhr.split(' ')[0].slice(0,5),
    Asr: t.Asr.split(' ')[0].slice(0,5),
    Maghrib: t.Maghrib.split(' ')[0].slice(0,5),
    Isha: t.Isha.split(' ')[0].slice(0,5)
  };
  return out;
}

// مسح جداول المؤقتات الحالية
function clearScheduledAll() {
  Object.values(scheduled).forEach(s => {
    if (s.timeoutId) clearTimeout(s.timeoutId);
    if (s.restoreId) clearTimeout(s.restoreId);
  });
  scheduled = {};
}

// عرض الجدول وتهيئة أزرار التحكم
function renderTable(timings) {
  tbody.innerHTML = '';
  todayCard.style.display = 'block';
  Object.entries(timings).forEach(([key, timeStr]) => {
    const row = document.createElement('tr');

    // اسم الصلاة بالعربي
    const arabic = {Fajr:'الفجر',Dhuhr:'الظهر',Asr:'العصر',Maghrib:'المغرب',Isha:'العشاء'}[key] || key;

    // خانات
    const nameTd = document.createElement('td'); nameTd.textContent = arabic;
    const timeTd = document.createElement('td'); timeTd.textContent = timeStr;

    // تفعيل تلقائي: checkbox
    const enabledTd = document.createElement('td');
    const chk = document.createElement('input'); chk.type='checkbox';
    chk.checked = !!(cfg[key] && cfg[key].enabled);
    chk.addEventListener('change', () => {
      cfg[key].enabled = chk.checked;
      saveConfig(cfg);
      // إعادة جدولة كاملة
      scheduleForTimings(timings);
    });
    enabledTd.appendChild(chk);

    // تأخير قبل التفعيل (دقائق) - number input
    const delayTd = document.createElement('td');
    const delayInput = document.createElement('input');
    delayInput.type='number'; delayInput.min=0; delayInput.value = cfg[key].delay;
    delayInput.addEventListener('change', () => {
      let v = parseInt(delayInput.value,10); if (isNaN(v)||v<0) v=0;
      cfg[key].delay = v; saveConfig(cfg);
      scheduleForTimings(timings);
    });
    delayTd.appendChild(delayInput); delayTd.appendChild(document.createTextNode(' د'));

    // مدة الصمت (دقائق)
    const durTd = document.createElement('td');
    const durInput = document.createElement('input');
    durInput.type='number'; durInput.min=1; durInput.value = cfg[key].duration;
    durInput.addEventListener('change', () => {
      let v = parseInt(durInput.value,10); if (isNaN(v)||v<1) v=1;
      cfg[key].duration = v; saveConfig(cfg);
    });
    durTd.appendChild(durInput); durTd.appendChild(document.createTextNode(' د'));

    // أوامر: تجريبي + حالة
    const actionsTd = document.createElement('td');
    const testBtn = document.createElement('button'); testBtn.className='small alt';
    testBtn.textContent = 'تجربة الآن';
    testBtn.addEventListener('click', () => {
      triggerSilentFlow(key, arabic, cfg[key].duration);
    });

    // عرض حالة مجدولة
    const stateSpan = document.createElement('div'); stateSpan.className='muted';
    stateSpan.style.marginTop='6px';
    actionsTd.appendChild(testBtn);
    actionsTd.appendChild(stateSpan);

    row.appendChild(nameTd);
    row.appendChild(timeTd);
    row.appendChild(enabledTd);
    row.appendChild(delayTd);
    row.appendChild(durTd);
    row.appendChild(actionsTd);

    tbody.appendChild(row);

    // احفظ reference لحالة العرض حتى نحدّثها لاحقاً
    scheduled[key] = { stateSpan, timeoutId: null, restoreId: null, fireAt: null, config: cfg[key] };
  });

  statusEl.textContent = 'تم عرض المواقيت. اضغط "جلب مواقيت اليوم" لإعادة التحديث أو غير الإعدادات ثم انتظر الجدولة.';
}

// جدولة تذكيرات لكل مواقيت
function scheduleForTimings(timings) {
  clearScheduledAll();

  const now = new Date();
  let count = 0;

  Object.entries(timings).forEach(([key, timeStr]) => {
    const conf = cfg[key];
    if (!conf || !conf.enabled) {
      if (scheduled[key]) scheduled[key].stateSpan.textContent = 'معطّل';
      return;
    }

    const adhanDate = hhmmToDate(timeStr);
    const fireAt = new Date(adhanDate.getTime() + conf.delay * 60 * 1000);

    if (fireAt <= now) {
      // إن فات الوقت لليوم، نتخطاه (أو يمكن جدولة لليوم التالي إن أردت)
      scheduled[key].stateSpan.textContent = 'انتهى أو فات اليوم';
      return;
    }

    const ms = fireAt.getTime() - now.getTime();
    const tid = setTimeout(() => {
      triggerSilentFlow(key, {Fajr:'الفجر',Dhuhr:'الظهر',Asr:'العصر',Maghrib:'المغرب',Isha:'العشاء'}[key] || key, conf.duration);
      // بعد الإطلاق، نظّف حالة timeout
      scheduled[key].timeoutId = null;
      scheduled[key].stateSpan.textContent = `تم التفعيل عند ${new Date().toLocaleTimeString()}`;
    }, ms);

    scheduled[key].timeoutId = tid;
    scheduled[key].fireAt = fireAt;
    scheduled[key].stateSpan.textContent = `مجدول للتفعيل عند ${fireAt.toLocaleTimeString()}`;
    count++;
  });

  statusEl.textContent = `تم جدولة ${count} تذكير/ات لليوم.`;
}

// تدفق إشعاري وتجهيزي عند وقت التفعيل
async function triggerSilentFlow(key, arabicName, durationMinutes) {
  // إرسال إشعار + اهتزاز + عرض حوار لفتح إعدادات DND
  const permission = Notification.permission === 'granted' ? true : await requestNotificationPermission();

  const body = `الصلاة: ${arabicName}\nاضغط لفتح إعدادات عدم الإزعاج. مدة الصمت المقترحة: ${durationMinutes} دقيقة.`;
  if (permission) {
    const n = new Notification(`صمت وقت الصلاة — ${arabicName}`, { body, tag: 'silent-'+key });
    n.onclick = () => {
      // حاول فتح إعدادات DND
      const intent = "intent:#Intent;action=android.settings.ZEN_MODE_SETTINGS;end";
      try { window.location = intent; } catch(e){ /* ignore */ }
    };
  } else {
    alert(`تذكير: فعّل وضع الصمت الآن (${arabicName}). مدة مقترحة: ${durationMinutes} دقيقة.`);
  }

  if (navigator.vibrate) navigator.vibrate([200,100,200]);

  // نُعلم المستخدم بخطوات يدوية لإلغاء الصمت بعد مدة
  // نعرض إشعار تذكير بعد durationMinutes
  setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification(`انتهاء مدة الصمت — ${arabicName}`, { body: `انقضت ${durationMinutes} دقيقة. الرجاء إعادة الصوت يدوياً إذا لزم.` , tag: 'silent-end-'+key });
    } else {
      alert(`انتهت مدة الصمت المقترحة (${durationMinutes} د) — أعد الصوت يدوياً.`);
    }
  }, durationMinutes * 60 * 1000);
}

// الحدث الرئيسي
getBtn.addEventListener('click', async () => {
  const city = cityInput.value.trim() || 'Alger';
  const country = countryInput.value.trim() || 'Algeria';
  statusEl.textContent = 'جاري جلب المواقيت...';
  try {
    const timings = await fetchTimings(city, country);
    renderTable(timings);
    scheduleForTimings(timings);
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'خطأ في جلب المواقيت: ' + (e.message || e);
    alert('فشل جلب المواقيت. تأكد من اسم المدينة/البلد أو اتصال الإنترنت.');
  }
});

// عند التحميل: اطلب إذن الإشعارات بشكل لطيف (اختياري)
// Comment/uncomment the next line if you want prompt on load
// requestNotificationPermission();

