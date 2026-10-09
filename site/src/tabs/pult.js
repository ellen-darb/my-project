import * as d3 from "d3";
import { load, fmt, sgnPct, hhmm, slotStr, dayLong, weekday, weekdayS, parseDay, monthName, tipShow, tipHide, dec } from "../lib/util.js";
import { drawMarey } from "../lib/marey.js";
import { drawLineMap, mapColor } from "../lib/linemap.js";
import { computeCorridor, drawCorridor, STEP } from "../lib/corridor.js";
import { plain, pl, interval } from "../lib/plain.js";
import { getEntry, getDay, setEntry, clearEntry, REASONS, ACT } from "../lib/journal.js";
import { sectorChart, pairsChart } from "../lib/charts.js";
import { runDay, applyMeasures, sectorLoad, segmentLoad, ACTIONABLE, FIRST, LAST, trainsOnLine } from "../lib/engine.js";

/* Примеры дней открываются на слотах, где есть что показать. */
const PRESETS = [
  { d: "2026-09-15", t: 28, label: "Не снимать составы", note: "15.09 · 08:00, график убирает составы в пик" },
  { d: "2026-02-26", t: 24, label: "Выпустить из резерва", note: "26.02 · 06:00, зимний пик" },
  { d: "2026-02-03", t: 29, label: "Резерв успеет не ко всему", note: "03.02 · 08:15, тесно через 30 минут" },
  { d: "2026-05-08", t: 25, label: "Добавить нельзя", note: "08.05 · 07:00, линия на пределе" },
  { d: "2026-07-21", t: 47, label: "Можно снять", note: "21.07 · 11:45, летом поток ниже" },
  { d: "2026-09-12", t: 52, label: "Людей больше, места хватает", note: "12.09 · 13:15, суббота +24%" },
];

/* Один источник статуса: решение движка на момент t и запись диспетчера. Цвет — только для отклонений (ISA-101). */
const LV = {
  ok: { c: "var(--green)", ic: "check", label: "Составов хватает" },
  watch: { c: "var(--amber)", ic: "eye", label: "Людей больше обычного, следите" },
  low: { c: "var(--blue)", ic: "minus", label: "Можно убрать составы" },
  soon: { c: "var(--amber)", ic: "clock", label: "Скоро станет тесно" },
  hour: { c: "var(--amber)", ic: "clock", label: "Нужна мера в ближайший час" },
  now: { c: "var(--red)", ic: "alert", label: "Нужна мера сейчас" },
  done: { c: "var(--green)", ic: "check", label: "Мера принята" },
  doneTight: { c: "var(--amber)", ic: "alert", label: "Мера принята, всё равно будет тесно" },
  refused: { c: "var(--red)", ic: "alert", label: "Отказ записан, будет тесно" },
  noact: { c: "var(--red)", ic: "alert", label: "Тесно, добавить состав нельзя" },
};
const ICON_SVG = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" />',
  eye: '<circle cx="12" cy="12" r="3" /><path d="M2.5 12s3.6-6.5 9.5-6.5S21.5 12 21.5 12s-3.6 6.5-9.5 6.5S2.5 12 2.5 12z" />',
  minus: '<path d="M5 12h14" />',
  clock: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.5l3.5 2" />',
  alert: '<path d="M12 4.5v9" /><circle cx="12" cy="18.5" r="0.6" />',
};
const svgIc = k => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SVG[k]}</svg>`;
const MICON = { hold: "=", add: "+", cut: "−", limit: "!", late: "!", watch: "i" };
const SECT = { north: "С севера в центр", south: "С юга в центр", line: "Вся линия" };
const WX = [[0, "ясно"], [3, "облачно"], [48, "туман"], [57, "морось"], [67, "дождь"], [77, "снег"], [82, "ливень"], [86, "снегопад"], [99, "гроза"]];
const wxText = c => WX.find(([m]) => c <= m)?.[1] || "";

let state = { d: "2026-09-15", t: 28, off: 0, alpha: null, auto: true, timer: null, ui: null, toast: null, redraw: null };

export function applyParams(params) {
  const d = params.get("d") || state.d, t = params.get("t") != null ? +params.get("t") : state.t;
  if (d === state.d && t === state.t) return;
  state.d = d; state.t = Math.max(FIRST, Math.min(LAST, t)); state.ui = null; state.off = 0;
  state.redraw?.(true);
}

export async function render(app, params) {
  if (params.get("d")) state.d = params.get("d");
  if (params.get("t")) state.t = Math.max(FIRST, Math.min(LAST, +params.get("t")));
  const [meta, days, fcst] = await Promise.all([load("meta.json"), load("days.json"), load("forecast.json")]);
  if (state.alpha == null) state.alpha = meta.c.alpha;
  if (!days.some(x => x.d === state.d)) state.d = "2026-09-15";
  app.innerHTML = `
  <section class="pu-head">
    <div class="pu-day">
      <p class="kicker" id="p-sched"></p>
      <h1 id="p-day"></h1>
      <div class="pu-chips" id="p-chips"></div>
    </div>
    <div class="pu-clock">
      <small>Сейчас</small><span id="p-clock" aria-live="polite"></span>
    </div>
  </section>
  <section class="pu-transport">
    <div class="tbtns">
      <button class="btn solid" id="p-play">▶ Проиграть день</button>
      <button class="btn" id="p-back" aria-label="Назад на 15 минут">−15 мин</button>
      <button class="btn" id="p-fwd" aria-label="Вперёд на 15 минут">+15 мин</button>
      <label class="daysel">День <select id="p-date"></select></label>
    </div>
    <div class="pu-railbox">
      <div class="rail" id="p-rail" role="slider" tabindex="0" aria-label="Время дня, стрелки влево и вправо"></div>
      <div class="rail-key"><span><i style="background:var(--green)"></i>составов хватает</span><span><i style="background:var(--amber)"></i>скоро тесно</span><span><i style="background:var(--red)"></i>нужна мера</span><span><i style="background:var(--blue)"></i>можно убрать</span>
        <span class="rail-mode"><span class="seg" id="p-auto" role="group" aria-label="Как считать прошлые советы"><button data-a="1" title="Прошлые советы считаются принятыми, пока вы не откажетесь: день читается как рабочая смена">Показ</button><button data-a="0" title="Считаются только советы, которые вы приняли сами">Рабочий</button></span><span id="p-auto-note"></span></span></div>
    </div>
  </section>
  <section class="pu-grid">
    <div class="pu-main">
      <div class="statebar" id="p-state"></div>
      <div id="p-dec"></div>
    </div>
    <div class="pu-side">
      <div class="pu-card">
        <div class="pu-card-h"><h2>Загрузка самого полного состава</h2>
          <span class="legend"><span><i style="background:var(--ink)"></i>по графику</span><span><i class="dash" style="color:var(--blue)"></i>с мерой</span><span><i style="background:var(--band);border:1px solid var(--rule)"></i>разброс</span></span></div>
        <div class="corridor" id="p-cor"></div>
        <div class="timeslider"><input type="range" id="p-slide" min="0" max="105" step="${STEP}" value="0" aria-label="Показать линию через столько минут"><output id="p-slide-o">сейчас</output></div>
      </div>
      <div class="pu-card">
        <div class="pu-card-h"><h2 id="p-map-t">Линия 1 сейчас</h2></div>
        <div class="lm-legend">
          <span class="lm-k"><b>Линия</b> — сколько людей в составе к центру</span>
          <span class="lm-scale"><span>свободно</span><span class="scale" id="p-scale"></span><span>битком</span></span>
          <span class="lm-k"><b>Полоска</b> — вход за час, черта — обычно</span>
        </div>
        <div id="p-map"></div>
      </div>
    </div>
  </section>
  <details class="more" id="p-more"><summary>Подробно: допущения, график движения, поток и парность за день</summary>
    <div class="assume">
      <div><h3>Допущение расчёта</h3>
        <p class="note">Выходов по станциям в данных нет, поэтому доля входящих, которые едут через перегон к центру, не измерена. Примем её равной:</p>
        <div class="seg" id="p-alpha" role="group" aria-label="Доля едущих к центру"></div>
        <p class="note" id="p-alpha-note"></p></div>
      <div id="p-wx"></div>
    </div>
    <div class="chart-title"><h3>График движения: час назад и два часа вперёд</h3></div>
    <div id="p-marey"></div>
    <div class="sectors">
      <div><div class="chart-title"><h3>Север → центр</h3><span class="note">перегон Пл. Ленина → Чернышевская</span></div><div id="p-north"></div></div>
      <div><div class="chart-title"><h3>Юг → центр</h3><span class="note">перегон Нарвская → Балтийская</span></div><div id="p-south"></div></div>
    </div>
    <div class="legend" style="padding-bottom:18px">
      <span><i style="background:var(--ink)"></i>по листу графика</span>
      <span><i class="dash" style="color:var(--ink)"></i>прогноз, серая полоса — 80% интервал</span>
      <span><i style="background:var(--blue)"></i>с принятыми мерами</span>
      <span><i class="dash" style="color:var(--ink-3)"></i>обычный день</span>
      <span><i class="dash" style="color:var(--red)"></i>норма 960 = 120 чел. × 8 вагонов</span>
    </div>
    <div class="sectors" style="grid-template-columns: 1fr">
      <div><div class="chart-title"><h3>Парность: лист графика и с мерами</h3><span class="legend"><span><i style="background:var(--ink)"></i>лист графика</span><span><i class="dash" style="color:var(--blue)"></i>с мерами, заливка — добавлено</span></span></div><div id="p-pairs"></div></div>
    </div>
  </details>
  <section class="daystrip">
    <h3>Примеры дней</h3>
    <div class="presets" id="p-presets"></div>
    <button class="btn" id="p-csv" hidden style="margin-top:18px">Скачать советы за день, CSV</button>
  </section>`;

  d3.select("#p-scale").selectAll("span").data(d3.range(0, 1459, 40)).join("span").style("flex", 1).style("background", v => mapColor(v));
  const $ = id => document.getElementById(id);
  const sel = $("p-date");
  sel.innerHTML = [...d3.group(days, d => parseDay(d.d).getMonth() + 1)].map(([m, list]) =>
    `<optgroup label="${monthName(m)}">${list.map(d => `<option value="${d.d}">${dayLong(d.d)}, ${weekdayS(d.d)}</option>`).join("")}</optgroup>`).join("");
  sel.onchange = () => { state.d = sel.value; state.ui = null; state.off = 0; draw(true); };
  $("p-alpha").innerHTML = [0.75, 0.85, 1].map(a => `<button data-a="${a}">${Math.round(a * 100)}%</button>`).join("");
  $("p-alpha").onclick = ev => { const a = ev.target.dataset?.a; if (a) { state.alpha = +a; draw(false); } };
  $("p-auto").onclick = ev => { const a = ev.target.dataset?.a; if (a != null) { state.auto = a === "1"; draw(false); } };

  const pr = $("p-presets");
  for (const p of PRESETS) {
    const b = document.createElement("button"); b.className = "preset";
    b.innerHTML = `<b>${p.label}</b><span>${p.note}</span>`;
    b.onclick = () => { state.d = p.d; state.t = p.t; state.ui = null; state.off = 0; draw(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
    pr.appendChild(b);
  }
  const go = tt => { state.t = Math.max(FIRST, Math.min(LAST, tt)); state.ui = null; state.off = 0; draw(false); };
  $("p-back").onclick = () => go(state.t - 1);
  $("p-fwd").onclick = () => go(state.t + 1);
  const play = $("p-play");
  function stop() { clearInterval(state.timer); state.timer = null; play.textContent = "▶ Проиграть день"; }
  play.onclick = () => {
    if (state.timer) { stop(); return; }
    if (state.t >= LAST) state.t = FIRST - 1;
    play.textContent = "❚❚ Пауза";
    state.timer = setInterval(() => { if (state.t >= LAST) { stop(); return; } go(state.t + 1); }, 1000);
  };
  $("p-slide").oninput = () => { state.off = +$("p-slide").value; draw(false); };
  const rail = $("p-rail");
  rail.addEventListener("keydown", ev => {
    const k = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -4, ArrowUp: 4, PageDown: -4, PageUp: 4 }[ev.key];
    if (k) { ev.preventDefault(); go(state.t + k); }
    else if (ev.key === "Home") { ev.preventDefault(); go(FIRST); } else if (ev.key === "End") { ev.preventDefault(); go(LAST); }
  });

  let day = null, view = null;
  state.redraw = nd => draw(nd);
  const cap = s => s[0].toUpperCase() + s.slice(1);

  async function draw(newDay) {
    if (newDay || !day || day.date !== state.d) {
      day = await load(`day/${state.d}.json`);
      rail.dataset.d = "";
    }
    const t = state.t, alpha = state.alpha;
    sel.value = state.d;
    history.replaceState(null, "", `#pult?d=${state.d}&t=${t}`);
    $("p-day").textContent = `${cap(weekday(state.d))}, ${dayLong(state.d)}`;
    $("p-sched").textContent = `${t >= 0 ? "Линия 1" : ""} · ${({ weekday_sep: "рабочий график с 1 сентября", weekday_summer: "летний рабочий график", weekend: "выходной график" })[day.sched]}`;
    $("p-clock").textContent = slotStr(t + 1);
    $("p-chips").innerHTML = chips(day, days.find(x => x.d === state.d), t);
    document.querySelectorAll("#p-auto button").forEach(b => b.classList.toggle("on", (b.dataset.a === "1") === state.auto));
    $("p-auto-note").textContent = state.auto ? "прошлые советы считаются принятыми, пока вы не откажетесь" : "считаются только принятые вами";
    document.querySelectorAll("#p-alpha button").forEach(b => b.classList.toggle("on", +b.dataset.a === alpha));

    const jr = getDay(day.date);
    view = analyse(meta, day, t, alpha, jr, state.auto, fcst);
    drawRail(rail, day, t, view.rail, go);
    renderState($("p-state"), view, meta);
    renderDecision($("p-dec"), view, day, meta, { redraw: () => draw(false), alpha });

    // коридор, ползунок и схема
    const off = Math.min(state.off || 0, 105);
    const nowMin = (t + 1) * 15, slot = t + 1 + off / 15;
    $("p-slide").value = off;
    $("p-slide-o").textContent = off ? `${hhmm(nowMin + off)} (+${off} мин)` : "сейчас";
    $("p-map-t").innerHTML = off ? `Линия 1 в ${hhmm(nowMin + off)} <span class="lm-fc">прогноз</span>` : `Линия 1 сейчас, ${hhmm(nowMin)}`;
    drawCorridor($("p-cor"), { pts: view.pts, off, norm: meta.c.norm, nowMin, onPick: o => { state.off = Math.min(o, 105); draw(false); } });
    const valid = slot < meta.engine.morning_end;
    const Pm = view.Pshow;
    const seg = d3.range(18).map(k => (valid && (k >= 10 || k <= 4)) ? segLoadArr(meta, view.E, Pm, k, alpha)[slot] : null);
    const s1 = Math.min(95, slot);
    const ent = d3.range(meta.stations.length).map(i => ({ x: d3.sum(d3.range(Math.max(0, s1 - 3), s1 + 1), s => view.E[s][i]), b: d3.sum(d3.range(Math.max(0, s1 - 3), s1 + 1), s => day.b[s][i]) }));
    drawLineMap($("p-map"), { meta, seg, ent, valid });

    $("p-wx").innerHTML = wxBlock(day, t);
    $("p-alpha-note").textContent = alpha === meta.c.alpha ? "Рабочее допущение 85%. Оценка по данным сверху — 89% на севере и 94% на юге, она зависит от доли метро, которую занимает линия 1." : `Загрузка пересчитана при ${Math.round(alpha * 100)}%: чем меньше доля, тем меньше людей в составе и тем реже нужны меры.`;

    if (!$("p-more").open) return;
    drawMarey($("p-marey"), { meta, nowMin, pairs: Pm, height: innerWidth < 640 ? 460 : 540,
      loadAt: (k, m) => { const s = Math.max(0, Math.min(95, Math.floor(m / 15))); return s < meta.engine.morning_end && (k >= 10 || k <= 4) ? segLoadArr(meta, view.E, Pm, k, alpha)[s] : null; } });
    const band = d3.range(1, 9).map(h => [fcst.q[h * 15][1], fcst.q[h * 15][3]]);
    const compact = innerWidth < 640;
    const full = view.fullP;
    for (const s of ["north", "south"]) {
      const typ = sectorLoad(meta, day.b, day.plan, s, alpha), fact = sectorLoad(meta, day.x, day.plan, s, alpha), sys = sectorLoad(meta, day.x, full, s, alpha);
      sectorChart($(`p-${s}`), { title: SECT[s], typ: Array.from(typ), fact: Array.from(fact), sys: Array.from(sys), fc: view.dc.sectors[s].fc, band, t, norm: meta.c.norm, maxTrain: meta.c.max_train, compact });
    }
    pairsChart($("p-pairs"), { plan: day.plan, sys: full, t, maxPairs: meta.c.max_pairs, height: 170, compact });
  }
  $("p-more").addEventListener("toggle", () => draw(false));

  // выгрузка рекомендаций дня: только там, где страница может предложить файл
  const csvBtn = $("p-csv");
  if (window.claude?.use) window.claude.use("downloads").then(dl => {
    if (!dl || !document.body.contains(csvBtn)) return;
    csvBtn.hidden = false;
    csvBtn.onclick = async () => {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const rows = [["Время", "Состояние", "Совет", "Почему"]];
      for (const r of runDay(meta, day, { upto: LAST + 1, alpha: state.alpha, journal: getDay(day.date), auto: state.auto }).decs) {
        const ms = r.dec.measures.filter(m => !m.repeat);
        if (!ms.length) continue;
        for (const m of ms) rows.push([slotStr(r.dec.t + 1), LV[levelOf(r.dec).k].label, plain(m.text), plain(m.why)]);
      }
      try { await dl.save({ filename: `takt-${state.d}.csv`, data: "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n") }); }
      catch (err) { if (["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(err?.code)) csvBtn.hidden = true; }
    };
  });
  await draw(true);
  return () => { stop(); state.redraw = null; clearTimeout(state.toast); document.querySelector(".toast")?.remove(); };
}

/* ---------- расчёт экрана: всё из одного прогона дня ---------- */
const segCache = new Map();
function segLoadArr(meta, E, P, k, alpha) {
  const key = `${k}|${alpha}|${P.join(",")}|${E[0][0]}|${E[95][0]}|${E[40][3]}`;
  if (!segCache.has(key)) { if (segCache.size > 400) segCache.clear(); segCache.set(key, segmentLoad(meta, E, P, k, alpha)); }
  return segCache.get(key);
}

function maxLoad(meta, E, P, alpha) {
  const a = sectorLoad(meta, E, P, "north", alpha), b = sectorLoad(meta, E, P, "south", alpha);
  return Array.from(a, (v, i) => Math.max(v, b[i]));
}

function analyse(meta, day, t, alpha, journal, auto, fcst) {
  const run = runDay(meta, day, { upto: t, alpha, journal, auto });
  const { dec: dc, E } = run.decs[run.decs.length - 1];
  const plan = day.plan, Pbefore = run.P;
  const act = dc.measures.filter(m => ACTIONABLE.has(m.type) && !m.declined);
  const Ppreview = applyMeasures(Pbefore.slice(), plan, act, meta.c.max_pairs);
  const entry = getEntryFrom(journal, t);
  const accepted = entry?.act === "accept";
  const Pshow = accepted ? Ppreview : Pbefore;
  const loadPlan = maxLoad(meta, E, plan, alpha), loadBefore = maxLoad(meta, E, Pbefore, alpha), loadPrev = maxLoad(meta, E, Ppreview, alpha);
  const pts = computeCorridor({ t, loadPlan: loadBefore, loadSys: loadPrev, morningEnd: meta.engine.morning_end, q: fcst.q });
  // весь день с учётом решений: для ленты и графиков
  const all = runDay(meta, day, { upto: LAST + 1, alpha, journal, auto });
  const fullP = all.P;
  const rail = all.decs.map(r => ({ t: r.dec.t, k: levelOf(r.dec).k }));
  // эффект в окне перегрузки
  let eff = null;
  const w = dc.window;
  if (w && (w.sector === "north" || w.sector === "south")) {
    const sec = w.sector;
    const stat = P => {
      const L = sectorLoad(meta, E, P, sec, alpha);
      let over = 0, tot = 0, peak = 0;
      for (let k = w.from; k <= w.to; k++) { const n = P[k] / 4; tot += n; over += n * Math.max(0, L[k] - meta.c.norm); peak = Math.max(peak, L[k]); }
      return { over, tot, peak };
    };
    eff = { before: stat(Pbefore), after: stat(Ppreview), sec };
  }
  return { dc, E, run, Pbefore, Ppreview, Pshow, plan, entry, accepted, act, pts, rail, fullP, eff, t, loadBefore, loadPrev };
}
const getEntryFrom = (j, t) => j[t] || null;

/* уровень строки состояния и ленты по решению движка (без записи диспетчера) */
function levelOf(dc) {
  if (dc.status === "ok") return { k: "ok" };
  if (dc.status === "watch") return { k: "watch" };
  if (dc.status === "low") return { k: "low" };
  const w = dc.window, eta = w.lead_min;
  const acts = dc.measures.some(m => ACTIONABLE.has(m.type) && !m.declined);
  if (!acts && dc.measures.some(m => ACTIONABLE.has(m.type) && m.declined)) return { k: "refused", eta };
  if (!acts) return { k: eta <= 0 ? "noact" : eta <= 60 ? "hour" : "soon", eta, noact: true };
  return { k: eta <= 0 ? "now" : eta <= 60 ? "hour" : "soon", eta };
}

function chips(day, info, t) {
  const r = info.ratio - 1;
  const more = Math.abs(r) < 0.03 ? "как обычно" : `на ${Math.round(Math.abs(r) * 100)}% ${r > 0 ? "больше" : "меньше"} обычного`;
  const h = Math.min(23, Math.floor((t + 1) / 4));
  const w = day.wx;
  const wx = w ? `<span class="chip" title="Погода в Санкт-Петербурге по часам (Open-Meteo). В прогнозе не используется: связь потока с погодой слабая"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/></svg>${w.t[h] > 0 ? "+" : ""}${String(w.t[h]).replace("-", "−")}°, ${wxText(w.c[h])}${w.p[h] > 0 ? `, ${String(w.p[h]).replace(".", ",")} мм` : ""}</span>` : "";
  return `<span class="chip">за день ${fmt(Math.round(info.entries / 1000))} тыс. человек, ${more}</span>${wx}`;
}

function wxBlock(day, t) {
  const w = day.wx;
  if (!w) return `<div><h3>Погода</h3><p class="note">Файл погоды не загружен.</p></div>`;
  const a = 6, b = 11;
  const rain = w.p.slice(a, b).reduce((s, v) => s + v, 0), snow = w.s.slice(a, b).reduce((s, v) => s + v, 0);
  const tm = Math.round(w.t.slice(a, b).reduce((s, v) => s + v, 0) / (b - a));
  return `<div><h3>Погода утром, 06–11 ч</h3><p class="note">${tm > 0 ? "+" : ""}${String(tm).replace("-", "−")}°, осадки ${String(Math.round(rain * 10) / 10).replace(".", ",")} мм${snow > 0 ? `, снег ${String(Math.round(snow * 10) / 10).replace(".", ",")} см` : ""}, ветер до ${Math.max(...w.w.slice(a, b))} км/ч.
    Данные Open-Meteo по Санкт-Петербургу. В прогноз потока погода не входит: за 83 будних дня она объясняет около 16% отклонения утреннего потока от обычного, прогноз лучше всего на 5%.</p></div>`;
}

/* ---------- лента дня ---------- */
function drawRail(node, day, t, rail, go) {
  if (node.dataset.d !== day.date + rail.map(r => r.k).join("")) {
    node.dataset.d = day.date + rail.map(r => r.k).join("");
    node.innerHTML = rail.map(r => `<button class="rail-c k-${r.k}" tabindex="-1" data-t="${r.t}" style="--c:${LV[r.k].c}" aria-hidden="true"></button>`).join("")
      + `<div class="rail-ax">${[7, 9, 12, 15, 18, 21].map(h => `<span style="left:${(h * 4 - 24 + 0.5) / 64 * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("")}</div>`;
    node.querySelectorAll(".rail-c").forEach(b => {
      const r = rail[+b.dataset.t - FIRST];
      b.onclick = () => go(+b.dataset.t);
      b.onmouseenter = ev => tipShow(ev, `<b>${slotStr(r.t + 1)}</b> · ${LV[r.k].label}`);
      b.onmouseleave = tipHide;
    });
  }
  node.querySelectorAll(".rail-c").forEach(b => { const tt = +b.dataset.t; b.classList.toggle("on", tt === t); b.classList.toggle("fut", tt > t); });
  node.setAttribute("aria-valuemin", FIRST); node.setAttribute("aria-valuemax", LAST); node.setAttribute("aria-valuenow", t);
  node.setAttribute("aria-valuetext", `${slotStr(t + 1)}, ${LV[rail[t - FIRST].k].label}`);
}

/* ---------- полоса состояния ---------- */
function peakText(view, meta) {
  const ok = view.pts.filter(p => p.valid);
  if (!ok.length) return "вне утреннего пика загрузку по входам не оцениваем";
  const p = Math.round(d3.max(ok, x => x.plan));
  return `самый полный состав за 2 часа: до ${fmt(p)} человек, норма ${fmt(meta.c.norm)}`;
}

function stateOf(view) {
  const base = levelOf(view.dc);
  const { entry, accepted, eff } = view;
  if (!["now", "hour", "soon"].includes(base.k)) return base;
  if (accepted && eff) return { ...base, k: eff.after.over > 0.5 ? "doneTight" : "done" };
  if (entry?.act === "reject") return { ...base, k: "refused" };
  return base;
}

function renderState(node, view, meta) {
  const dc = view.dc, lv = stateOf(view), L = LV[lv.k], w = dc.window;
  node.style.setProperty("--c", L.c);
  node.classList.toggle("quiet", lv.k === "ok");
  let sub;
  if (["now", "hour", "soon", "noact", "refused", "done", "doneTight"].includes(lv.k) && w) {
    const when = w.lead_min <= 0 ? "уже сейчас" : `через ${w.lead_min} мин`;
    const peak = lv.k === "done" || lv.k === "doneTight" ? Math.round(view.eff.after.peak) : w.peak;
    sub = `${SECT[w.sector]}: ${when}, с ${slotStr(w.from)} до ${slotStr(w.to + 1)}, до ${fmt(peak)} человек в составе при норме ${fmt(meta.c.norm)}`;
  } else if (lv.k === "watch") sub = dc.window.peak ? `в составах пока есть место: до ${fmt(dc.window.peak)} человек при норме ${fmt(meta.c.norm)}` : "загрузку составов по входам оценить нельзя, ориентируйтесь на доклады станций";
  else if (lv.k === "low") sub = "поток ниже обычного, составы будут заполнены меньше чем на 70%";
  else sub = peakText(view, meta);
  node.innerHTML = `<div class="sb-ic" aria-hidden="true">${svgIc(L.ic)}</div>
    <div class="sb-txt"><div class="sb-main">${L.label}</div><div class="sb-sub">${sub}</div></div>
    <div class="sb-meta">данные до ${slotStr(dc.t + 1)}<br>пересчёт каждые 15 мин</div>`;
  node.setAttribute("role", "status");
}

/* ---------- карточка решения ---------- */
function renderDecision(node, view, day, meta, ctx) {
  const { dc, eff, entry } = view, t = dc.t;
  const lv = stateOf(view);
  const live = dc.measures.filter(m => !m.repeat || ACTIONABLE.has(m.type));
  const acts = view.act;
  const hasAct = acts.length > 0;

  if (lv.k === "ok") {
    node.innerHTML = `<div class="rec rec-quiet"><p class="rec-big">Меры не нужны</p><p class="rec-why">${peakText(view, meta)}.</p>
      ${linestate(view, meta)}</div>`;
    return;
  }

  const fresh = dc.measures.filter(m => !(m.repeat && !ACTIONABLE.has(m.type)) || !dc.measures.some(x => x !== m && !x.repeat));
  const reps = dc.measures.filter(m => !fresh.includes(m));
  const items = fresh.map(m => `
    <li class="measure ${m.repeat ? "rep" : ""} ${m.declined ? "dec" : ""}"><div class="ic t-${m.type}">${MICON[m.type]}</div>
    <div><b>${plain(m.text)}</b><span>${m.declined ? "Вы отказались от этой меры раньше, повторно не предлагаем. " : ""}${plain(m.why)}</span></div></li>`).join("");

  // что будет: с мерой и без неё
  let gain = "";
  const alphaRange = w => { const a = state.alpha, lo = Math.round(w * 0.75 / a), hi = Math.round(w * 1 / a); return lo === hi ? "" : ` · при другой доле едущих к центру: ${fmt(lo)}–${fmt(hi)}`; };
  if (eff) {
    const b = eff.before, a = eff.after;
    if (hasAct && (a.over < b.over * 0.99 || a.peak < b.peak - 10)) {
      gain = `<div class="gain"><p class="gain-k">Если выполнить совет, с ${slotStr(dc.window.from)} до ${slotStr(dc.window.to + 1)}</p>
        <div class="gain-row"><div><span class="num">${fmt(b.over)}</span><i>→</i><b class="num">${fmt(a.over)}</b><small>человек едут сверх нормы, всего по составам</small></div>
        <div><span class="num">${fmt(b.peak)}</span><i>→</i><b class="num">${fmt(a.peak)}</b><small>человек в самом полном составе</small></div></div>
        <p class="gain-n">Расчёт при допущении, что к центру едут ${Math.round(state.alpha * 100)}% входящих${alphaRange(b.peak)}</p></div>`;
    } else if (b.over > 1) {
      gain = `<div class="gain gain-none"><p class="gain-k">Если ничего не менять, с ${slotStr(dc.window.from)} до ${slotStr(dc.window.to + 1)}</p>
        <div class="gain-row"><div><b class="num">${fmt(b.over)}</b><small>человек едут сверх нормы, всего по составам</small></div>
        <div><b class="num">${fmt(b.peak)}</b><small>человек в самом полном составе</small></div></div>
        <p class="gain-n">Расчёт при допущении, что к центру едут ${Math.round(state.alpha * 100)}% входящих${alphaRange(b.peak)}</p></div>`;
    }
  }

  // смены машинистов: лишние пары × оборот
  let extraH = 0;
  for (const m of acts) if (m.type === "hold" || m.type === "add") for (let k = m.from; k <= m.to; k++) extraH += Math.max(0, view.Ppreview[k] - view.Pbefore[k]);
  extraH = extraH * 0.25 * meta.c.turnover / 60;
  const needCrew = extraH > 0.05;
  const checks = dc.checks?.length ? `<details class="chk"><summary>Можно ли это сделать</summary><ul class="checks">${dc.checks.map(c => { const [r, n] = checkText(c); return `<li><span class="${c.ok ? "y" : "n"}">${c.ok ? "✓" : "✕"}</span><span>${r}<em>${n}</em></span></li>`; }).join("")}
    <li><span class="q">?</span><span>Смены машинистов<em>${needCrew ? `≈${dec(extraH)} машинисто-ч сверх графика, данных о сменах нет` : "данных о сменах нет"}</em></span></li></ul></details>` : "";

  let actions = "";
  if (hasAct) {
    if (entry?.act === "accept") actions = `<div class="rec-done"><span>Принято в ${slotStr(t + 1)}. Записано в журнал, расчёт обновлён.</span><button id="p-undo">Отменить</button></div>`;
    else if (entry?.act === "reject") actions = `<div class="rec-done off"><span>Не нужно: ${(entry.reason || "").toLowerCase()}. Расчёт учитывает отказ.</span><button id="p-undo">Вернуть совет</button></div>`;
    else if (entry?.act === "snooze") actions = `<div class="rec-done off"><span>Отложено, вернёмся к совету в ${slotStr(t + 2)}.</span><button id="p-undo">Вернуть сейчас</button></div>`;
    else if (state.ui === "confirm") actions = `<div class="rec-confirm"><p>Подтвердите, что берёте в работу:</p>
      <ul>${acts.map(m => `<li>${plain(m.text)}</li>`).join("")}</ul>
      ${needCrew ? `<label class="crew-ok"><input type="checkbox" id="p-crew"> Смены машинистов проверил по графику бригад: на ≈${dec(extraH)} машинисто-ч сверх графика людей хватает</label>` : ""}
      <div class="rec-actions" style="margin:0"><button class="btn solid" id="p-yes" ${needCrew ? "disabled" : ""}>Подтвердить</button><button class="btn" id="p-no">Назад</button></div></div>`;
    else if (state.ui === "reject") actions = `<div class="rec-confirm"><p>Почему не нужно?</p><div class="rec-reasons">${REASONS.map((r, i) => `<button class="btn" data-r="${i}">${r}</button>`).join("")}</div>
      <div class="rec-actions" style="margin-bottom:0"><button class="btn" id="p-no">Назад</button></div></div>`;
    else actions = `<div class="rec-actions"><button class="btn solid" id="p-accept">Принять</button><button class="btn" id="p-snooze">Напомнить через 15 мин</button><button class="btn" id="p-reject">Не нужно</button></div>`;
  }

  const head = lv.k === "low" ? "Часть составов можно отправить в депо" : lv.k === "watch" ? "Составы не добавлять" : hasAct || entry ? "Что сделать" : "Что можно сделать";
  node.innerHTML = `<div class="rec">
    <p class="kicker">${head}</p>
    <ul class="measures">${items}</ul>
    ${reps.length ? `<p class="rep-note">Остаётся в силе: ${reps.map(m => plain(m.text).replace(/[.:]$/, "")).join("; ")}</p>` : ""}
    ${actions}
    ${gain}
    ${checks}
    ${linestate(view, meta)}
  </div>`;

  const q = id => document.getElementById(id), ui = v => { state.ui = v; ctx.redraw(); };
  const texts = acts.map(m => plain(m.text));
  q("p-accept") && (q("p-accept").onclick = () => ui("confirm"));
  q("p-no") && (q("p-no").onclick = () => ui(null));
  q("p-reject") && (q("p-reject").onclick = () => ui("reject"));
  q("p-crew") && (q("p-crew").onchange = e => { q("p-yes").disabled = !e.target.checked; });
  q("p-yes") && (q("p-yes").onclick = () => {
    setEntry(day.date, t, { act: "accept", crew: needCrew, m: texts });
    state.ui = null; ctx.redraw();
    toast("Принято. Решение записано, расчёт обновлён.", () => { clearEntry(day.date, t); ctx.redraw(); });
  });
  q("p-snooze") && (q("p-snooze").onclick = () => { setEntry(day.date, t, { act: "snooze", m: texts }); state.ui = null; ctx.redraw(); });
  node.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    setEntry(day.date, t, { act: "reject", reason: REASONS[+b.dataset.r], m: texts });
    state.ui = null; ctx.redraw();
  });
  q("p-undo") && (q("p-undo").onclick = () => { clearEntry(day.date, t); ctx.redraw(); });
}

function linestate(view, meta) {
  const P = view.Pshow[view.t + 1], trains = trainsOnLine(P);
  return `<div class="linestate"><span>На линии сейчас</span><span><b>${trains}</b> из ${meta.c.max_trains} ${pl(trains, "состава", "составов", "составов")}</span><span>интервал <b>${interval(P)}</b>, самый частый 1:53</span></div>`;
}

/* короткая плашка с отменой на 10 секунд */
function toast(text, onUndo) {
  document.querySelector(".toast")?.remove(); clearTimeout(state.toast);
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status");
  el.innerHTML = `<span>${text}</span><button>Отменить</button>`;
  el.querySelector("button").onclick = () => { el.remove(); clearTimeout(state.toast); onUndo(); };
  document.body.appendChild(el);
  state.toast = setTimeout(() => el.remove(), 10000);
}

function checkText(c) {
  if (c.rule.startsWith("Запас по интервалу")) {
    const m = c.note.match(/(\d+) из ([\d,]+)/);
    return ["Можно ли пустить составы чаще", m ? (c.ok ? `да: сейчас интервал ${interval(+m[1])}, самый частый 1:53` : `нет: уже интервал ${interval(+m[1])}, это предел`) : c.note];
  }
  if (c.rule.startsWith("Свободные составы")) return ["Есть ли свободные составы", c.note.replace("на линии", "на линии уже")];
  if (c.rule.startsWith("Резерв успевает")) {
    const m = c.note.match(/(-?\d+) мин до начала/);
    return ["Успеет ли резерв из депо", m ? (c.ok ? `да: до тесноты ${m[1]} мин, выезд занимает 15–20 мин` : `нет: до тесноты ${Math.max(0, m[1])} мин, выезд занимает 15–20 мин`) : c.note];
  }
  return [c.rule, c.note];
}
