import * as d3 from "d3";

const cache = new Map();
export function load(name) {
  if (!cache.has(name)) cache.set(name, fetch(`data/${name}`).then(r => {
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r.json();
  }));
  return cache.get(name);
}

export const nf = new Intl.NumberFormat("ru-RU");
export const fmt = v => nf.format(Math.round(v));
export const pct = (v, d = 0) => `${(v * 100).toFixed(d).replace(".", ",").replace("-", "−")}%`;
export const sgnPct = (v, d = 0) => (v > 0 ? "+" : "") + pct(v, d);
export const dec = (v, d = 1) => v.toFixed(d).replace(".", ",");
export const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
export const slotStr = s => hhmm(s * 15);

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_N = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WD = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WD_S = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const dayLong = s => { const d = parseDay(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const dayShort = s => { const d = parseDay(s); return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const weekday = s => WD[parseDay(s).getDay()];
export const weekdayS = s => WD_S[parseDay(s).getDay()];
export const monthName = m => MONTHS_N[m - 1];
export const monthGen = m => MONTHS[m - 1];

export const SCHED_TITLE = { weekday_sep: "рабочий день, график с 01.09", weekday_summer: "рабочий день, летний график с 01.06", weekend: "выходной график" };

export function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/* Загрузка состава: ниже нормы — серая шкала, выше — красная. Середина — норма 960. */
let pal = null;
export function resetPalette() { pal = null; }
export function loadColor(L, norm = 960) {
  if (!pal) pal = { lo: d3.interpolateRgb(css("--rule"), css("--ink-3")), unk: css("--unknown") };
  if (L == null || !isFinite(L)) return pal.unk;
  if (L <= norm) return pal.lo(Math.max(0, L) / norm);
  const k = Math.min(1, (L - norm) / (1458 - norm));
  return k < 0.5 ? d3.interpolateRgb("#F2908A", "#D6083B")(k / 0.5) : d3.interpolateRgb("#D6083B", "#6A0020")((k - 0.5) / 0.5);
}

/* Подсказка */
const tipEl = () => document.getElementById("tip");
export function tipShow(ev, html) {
  const el = tipEl(); el.innerHTML = html; el.style.opacity = 1;
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
  el.style.left = x + "px"; el.style.top = y + "px";
}
export function tipHide() { tipEl().style.opacity = 0; }

export function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

/* Прогноз входов той же формулой, что pipeline/simulate.py: база × (1 + w(h)·(поправка за час − 1)) */
export function forecastEntries(x, b, t, w) {
  const S = x[0].length, E = x.map(r => r.slice());
  const r = new Array(S).fill(0).map((_, s) => {
    let xs = 30, bs = 30;
    for (let k = t - 3; k <= t; k++) { xs += x[k][s]; bs += b[k][s]; }
    return xs / bs;
  });
  for (let k = t + 1; k < x.length; k++) {
    const h = Math.min(8, k - t), wh = w[h];
    for (let s = 0; s < S; s++) E[k][s] = b[k][s] * (1 + wh * (r[s] - 1));
  }
  return E;
}

export function width(node, min = 280) { return Math.max(min, node.getBoundingClientRect().width); }
