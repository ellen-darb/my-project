import * as d3 from "d3";
import { load, fmt, sgnPct, hhmm, slotStr, dayLong, weekday, weekdayS, parseDay, monthName, SCHED_TITLE,
  forecastEntries, tipShow, tipHide, loadColor, dec } from "../lib/util.js";
import { drawMarey } from "../lib/marey.js";
import { drawLineMap, mapColor } from "../lib/linemap.js";
import { computeCorridor, overloadIn, drawCorridor, STEP } from "../lib/corridor.js";
import { plain, pl } from "../lib/plain.js";
import { getEntry, setEntry, clearEntry, REASONS, ACT } from "../lib/journal.js";
import { sectorChart, pairsChart } from "../lib/charts.js";

const PRESETS = [
  { d: "2026-09-15", t: 28, label: "15.09 · самое тяжёлое утро" },
  { d: "2026-02-26", t: 27, label: "26.02 · поток выше обычного" },
  { d: "2026-05-08", t: 64, label: "08.05 · канун праздника, линия на пределе" },
  { d: "2026-07-21", t: 40, label: "21.07 · летом поток ниже, можно снять" },
  { d: "2026-09-12", t: 52, label: "12.09 · суббота, днём +24%, составы не нужны" },
];

const STATUS = {
  ok: { c: "var(--green)", label: "Составов хватает" },
  structural: { c: "var(--amber)", label: "Тесно по графику" },
  anomaly: { c: "var(--red)", label: "Людей больше обычного" },
  low: { c: "var(--blue)", label: "Можно убрать составы" },
};
const ICON = { hold: "=", add: "+", cut: "−", limit: "!", watch: "i" };
const SECT = { north: "С севера в центр", south: "С юга в центр", line: "Вся линия" };
const GROUP = { "mon-thu": "будний день", fri: "пятница", sat: "суббота", sun: "воскресенье или праздник" };

let state = { d: "2026-09-15", t: 28, mode: "sys", off: 0, timer: null, ui: null, showAll: false, toast: null };

export async function render(app, params) {
  if (params.get("d")) state.d = params.get("d");
  if (params.get("t")) state.t = +params.get("t");
  const [meta, days, fcst] = await Promise.all([load("meta.json"), load("days.json"), load("forecast.json")]);
  let seen = false;
  try { seen = localStorage.getItem("takt-hint") === "1"; } catch (e) { /* хранилище недоступно */ }
  app.innerHTML = `
  <div class="pult-head">
    <div class="pult-day"><h1 id="p-day"></h1>
      <div class="meta"><label class="daysel">Другой день <select id="p-date"></select></label><span id="p-meta"></span></div></div>
    <div class="clock"><small>Сейчас</small><span id="p-clock"></span></div>
  </div>
  <div class="transport">
    <div class="tbtns"><button class="btn solid" id="p-play" aria-label="Проиграть">▶ Проиграть день</button>
    <button class="btn" id="p-back" aria-label="Назад на 15 минут">−15</button>
    <button class="btn" id="p-fwd" aria-label="Вперёд на 15 минут">+15</button></div>
    <div><div class="rail" id="p-rail"></div>
    <div class="rail-key"><span><i style="background:var(--green)"></i>составов хватает</span><span><i style="background:var(--amber)"></i>тесно по графику</span><span><i style="background:var(--red)"></i>людей больше обычного</span><span><i style="background:var(--blue)"></i>можно убрать составы</span></div></div>
  </div>
  <div class="statebar" id="p-state"></div>
  <div class="pult-grid">
    <div class="left">
      <div class="chart-title">
        <h3 id="p-map-t">Линия 1 сейчас</h3>
        <div class="seg" id="p-mode"><button data-m="plan">Как по графику</button><button data-m="sys">Если выполнить совет</button></div>
      </div>
      <div class="corridor-head"><h3>Какой будет загрузка в ближайшие 2 часа</h3>
        <span class="legend"><span><i style="background:var(--ink)"></i>по графику</span><span><i class="dash" style="color:var(--blue)"></i>если выполнить совет</span><span><i style="background:var(--band);border:1px solid var(--rule)"></i>разброс прогноза</span></span></div>
      <div class="corridor" id="p-cor"></div>
      <div class="timeslider"><input type="range" id="p-slide" min="0" max="120" step="${STEP}" value="0" aria-label="На сколько минут вперёд показать линию"><output id="p-slide-o">сейчас</output></div>
      <div class="lm-legend">
        <span class="lm-k"><b>Линия</b> — сколько людей в составе, который едет в центр</span>
        <span class="lm-scale"><span>свободно</span><span class="scale" id="p-scale"></span><span>битком</span></span>
        <span class="lm-k"><b>Полоска</b> — сколько вошло на станции за час, черта — сколько обычно</span>
      </div>
      <div id="p-map"></div>
    </div>
    <div class="right" id="p-dec"></div>
  </div>
  <details class="more" id="p-more"><summary>Подробно: график движения, поток и парность за день</summary>
  <div class="chart-title"><h3>График движения: час назад и два часа вперёд</h3></div>
  <div id="p-marey"></div>
  <div class="sectors">
    <div><div class="chart-title"><h3>Север → центр</h3><span class="note">перегон Пл. Ленина → Чернышевская</span></div><div id="p-north"></div></div>
    <div><div class="chart-title"><h3>Юг → центр</h3><span class="note">перегон Нарвская → Балтийская</span></div><div id="p-south"></div></div>
  </div>
  <div class="legend" style="padding-bottom:18px">
    <span><i style="background:var(--ink)"></i>факт по графику</span>
    <span><i class="dash" style="color:var(--ink)"></i>прогноз, серая полоса — 80% интервал</span>
    <span><i style="background:var(--blue)"></i>факт с мерами Такта</span>
    <span><i class="dash" style="color:var(--ink-3)"></i>обычный день (база)</span>
    <span><i class="dash" style="color:var(--red)"></i>норма 960 = 120 чел. × 8 вагонов</span>
  </div>
  <div class="sectors" style="grid-template-columns: 1fr">
    <div><div class="chart-title"><h3>Парность: лист графика и с мерами Такта</h3><span class="legend"><span><i style="background:var(--ink)"></i>лист графика</span><span><i class="dash" style="color:var(--blue)"></i>с мерами, заливка — добавлено</span></span></div><div id="p-pairs"></div></div>
  </div>
  </details>
  <div class="daystrip">
    <h3>Примеры дней</h3>
    <div class="presets" id="p-presets"></div>
    <button class="btn" id="p-csv" hidden style="margin-top:18px">Скачать советы за день, CSV</button>
  </div>`;

  // шкалы легенды
  const sc = d3.select("#p-scale");
  d3.range(0, 1459, 40).forEach(v => sc.append("span").style("flex", 1).style("background", mapColor(v)));
  // выбор дня
  const sel = document.getElementById("p-date");
  sel.innerHTML = [...d3.group(days, d => parseDay(d.d).getMonth() + 1)].map(([m, list]) =>
    `<optgroup label="${monthName(m)}">${list.map(d => `<option value="${d.d}">${dayLong(d.d)}, ${weekdayS(d.d)}</option>`).join("")}</optgroup>`).join("");
  sel.onchange = () => { state.d = sel.value; state.ui = null; draw(true); };
  const hx = document.getElementById("p-hint-x");
  if (hx) hx.onclick = () => { document.getElementById("p-hint").remove(); try { localStorage.setItem("takt-hint", "1"); } catch (e) { /* без хранилища */ } };
  // выгрузка рекомендаций дня: только там, где страница может предложить файл
  const csvBtn = document.getElementById("p-csv");
  if (window.claude?.use) window.claude.use("downloads").then(dl => {
    if (!dl || !document.body.contains(csvBtn)) return;
    csvBtn.hidden = false;
    csvBtn.onclick = async () => {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const rows = [["Время", "Состояние", "Людей к обычному", "Совет", "Почему"]];
      for (const e of day.dec) {
        const st = STATUS[e.s]?.label || e.s, lr = sgnPct(e.lr - 1);
        if (!e.m.length) rows.push([slotStr(e.t), st, lr, "по графику", ""]);
        for (const m of e.m) rows.push([slotStr(e.t), st, lr, plain(m.text), plain(m.why)]);
      }
      const csv = "\ufeff" + rows.map(r => r.map(q).join(";")).join("\r\n");
      try { await dl.save({ filename: `takt-${state.d}.csv`, data: csv }); }
      catch (err) { if (["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(err?.code)) csvBtn.hidden = true; }
    };
  });
  const pr = document.getElementById("p-presets");
  for (const p of PRESETS) {
    const b = document.createElement("button"); b.className = "btn"; b.textContent = p.label;
    b.onclick = () => { state.d = p.d; state.t = p.t; state.ui = null; draw(true); };
    pr.appendChild(b);
  }

  document.getElementById("p-back").onclick = () => { state.t = Math.max(24, state.t - 1); state.ui = null; draw(false); };
  document.getElementById("p-fwd").onclick = () => { state.t = Math.min(87, state.t + 1); state.ui = null; draw(false); };
  const play = document.getElementById("p-play");
  play.onclick = () => {
    if (state.timer) { stop(); return; }
    play.textContent = "❚❚ Пауза";
    state.timer = setInterval(() => {
      if (state.t >= 87) { stop(); return; }
      state.t++; state.ui = null; draw(false);
    }, 900);
  };
  function stop() { clearInterval(state.timer); state.timer = null; play.textContent = "▶ Проиграть день"; }
  const slide = document.getElementById("p-slide");
  slide.oninput = () => { state.off = +slide.value; draw(false); };
  document.querySelectorAll("#p-mode button").forEach(b => b.onclick = () => { state.mode = b.dataset.m; draw(false); });

  let day = null;
  async function draw(newDay) {
    if (newDay || !day || day.date !== state.d) {
      day = await load(`day/${state.d}.json`);
      const info = days.find(x => x.d === state.d);
      document.getElementById("p-day").textContent = `${cap(weekday(state.d))}, ${dayLong(state.d)} 2026`;
      document.getElementById("p-meta").innerHTML = `за день вошло ${fmt(Math.round(info.entries / 1000))} тыс. человек, ${more(info.ratio - 1)}`;
    }
    const t = state.t;
    sel.value = state.d;
    drawRail(document.getElementById("p-rail"), day, t, tt => { state.t = tt; state.ui = null; draw(false); });
    history.replaceState(null, "", `#pult?d=${state.d}&t=${t}`);
    document.getElementById("p-clock").textContent = slotStr(t + 1);
    document.querySelectorAll("#p-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === state.mode));

    const pairs = state.mode === "sys" ? day.sys : day.plan;
    const E = forecastEntries(day.x, day.b, t, meta.w_ratio);
    const entriesAt = s => (s <= t ? day.x[s] : E[s]);
    const off = state.off || 0, nowMin = (t + 1) * 15, tm = nowMin + off;
    const slideEl = document.getElementById("p-slide");
    slideEl.value = off;
    document.getElementById("p-slide-o").textContent = off ? `${hhmm(tm)} (+${off} мин)` : "сейчас";
    document.getElementById("p-map-t").innerHTML = off ? `Линия 1 в ${hhmm(tm)} <span class="lm-fc">прогноз</span>` : `Линия 1 сейчас, ${hhmm(tm)}`;
    drawLineMap(document.getElementById("p-map"), { meta, timeMin: tm, pairs, entriesAt, base: day.b });

    const dc = day.dec[t - 24];
    const pts = computeCorridor({ tm0: nowMin, entriesAt, planPairs: day.plan, sysPairs: day.sys, meta, q: fcst.q });
    drawCorridor(document.getElementById("p-cor"), { pts, off, norm: meta.c.norm, nowMin, onPick: o => { state.off = o; draw(false); } });
    const ov = overloadIn(pts, meta.c.norm);
    renderState(document.getElementById("p-state"), dc, ov, pts, nowMin, meta);
    renderDecision(document.getElementById("p-dec"), dc, day, meta, t, { ov, pts, nowMin, redraw: () => draw(false) });

    if (!document.getElementById("p-more").open) return;
    drawMarey(document.getElementById("p-marey"), { day, meta, nowMin: (t + 1) * 15, pairs, entriesAt,
      height: innerWidth < 640 ? 460 : 540 });
    const band = d3.range(1, 9).map(h => [fcst.q[h * 15][1], fcst.q[h * 15][3]]);
    const compact = innerWidth < 640;
    for (const s of ["north", "south"]) {
      sectorChart(document.getElementById(`p-${s}`), { title: SECT[s], typ: day.load_typ[s], fact: day.load_plan[s],
        sys: day.load_sys[s], fc: dc.fc[s], band, t, norm: meta.c.norm, maxTrain: meta.c.max_train, compact });
    }
    pairsChart(document.getElementById("p-pairs"), { plan: day.plan, sys: day.sys, t, maxPairs: meta.c.max_pairs, height: 170, compact });
  }
  document.getElementById("p-more").addEventListener("toggle", () => draw(false));
  await draw(true);
  return () => { stop(); clearTimeout(state.toast); document.querySelector(".toast")?.remove(); };
}

function drawRail(node, day, t, go) {
  if (node.dataset.d !== day.date) {
    node.dataset.d = day.date;
    node.innerHTML = day.dec.map(dc => {
      const m = dc.m.map(x => ICON[x.type]).join("");
      return `<button class="rail-c" data-t="${dc.t}" style="--c:${STATUS[dc.s].c}" aria-label="${slotStr(dc.t + 1)}: ${STATUS[dc.s].label}"></button>`;
    }).join("") + `<div class="rail-ax">${[7, 9, 12, 15, 18, 21].map(h => `<span style="left:${(h * 4 - 25 + 0.5) / 64 * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("")}</div>`;
    node.querySelectorAll(".rail-c").forEach(b => {
      const dc = day.dec[+b.dataset.t - 24];
      b.onclick = () => go(+b.dataset.t);
      b.onmouseenter = ev => tipShow(ev, `<b>${slotStr(dc.t + 1)}</b> · ${STATUS[dc.s].label}${dc.m.map(x => `<br>${plain(x.text)}`).join("")}`);
      b.onmouseleave = tipHide;
    });
  }
  node.querySelectorAll(".rail-c").forEach(b => b.classList.toggle("on", +b.dataset.t === t));
}

/* Полоса состояния: одно главное слово, через сколько станет тесно, на какие данные опирается */
function etaOf(ov, nowMin) {
  if (ov.mid == null) return null;
  if (ov.mid === 0) return { big: "уже сейчас", small: "самый полный состав выше нормы" };
  const early = ov.early != null && ov.early < ov.mid ? ov.early : null;
  return { big: `через ${ov.mid} мин`, small: early != null ? `может начаться уже через ${early} мин, около ${hhmm(nowMin + ov.mid)}` : `около ${hhmm(nowMin + ov.mid)}` };
}

function stateLevel(dc, ov) {
  if (ov.mid === 0) return { c: "var(--red)", label: "Нужна мера сейчас", quiet: false };
  const soon = ov.mid != null ? ov.mid : (dc.s === "structural" || dc.s === "anomaly") && dc.w?.lead_min != null ? dc.w.lead_min : null;
  if (soon != null && soon <= 60) return { c: "var(--amber)", label: "Нужна мера в ближайший час", quiet: false };
  if (soon != null) return { c: "var(--amber)", label: "Скоро станет тесно, следите", quiet: false };
  return { c: "var(--green)", label: dc.s === "low" ? "Хватает с запасом" : "Составов хватает", quiet: true };
}

function renderState(node, dc, ov, pts, nowMin, meta) {
  const lv = stateLevel(dc, ov), eta = etaOf(ov, nowMin);
  node.style.setProperty("--c", lv.c);
  node.classList.toggle("quiet", lv.quiet);
  const peak = Math.round(d3.max(pts, p => p.plan));
  node.innerHTML = `<div class="sb-main">${lv.label}</div>
    ${eta ? `<div class="sb-eta">${eta.big}<small>${eta.small}</small></div>` : `<div class="sb-eta">в ближайшие 2 часа не выше ${fmt(peak)}<small>человек в самом полном составе, норма ${fmt(meta.c.norm)}</small></div>`}
    <div class="sb-meta">данные до ${slotStr(dc.t + 1)}<br>пересчёт каждые 15 минут</div>`;
}

function renderDecision(node, dc, day, meta, t, ctx) {
  const { ov, nowMin } = ctx;
  const lv = stateLevel(dc, ov), eta = etaOf(ov, nowMin);
  const st = STATUS[dc.s];
  const w = dc.w;
  const when = eta ? (ov.mid === 0 ? "уже сейчас" : eta.big) : (w?.lead_min ? `через ${w.lead_min} мин` : "уже сейчас");
  let head, why;
  if (dc.s === "ok") {
    head = "Следующие 2 часа в составах свободно";
    why = `Людей ${more(dc.lr - 1)}. Ничего менять не нужно.`;
  } else if (dc.s === "low") {
    head = `Людей ${more(dc.lr - 1)}`;
    why = "В составах будет заполнено меньше 70% мест, часть составов можно отправить в депо.";
  } else {
    head = w.sector === "line" ? `Людей ${more(dc.lr - 1)}`
      : `${SECT[w.sector]}: до ${fmt(w.peak)} человек в составе с ${slotStr(w.from)} до ${slotStr(w.to + 1)}`;
    why = dc.s === "structural"
      ? `Людей как обычно, но составов по графику мало: норма ${fmt(meta.c.norm)} человек в составе. Станет тесно ${when}.`
      : `Людей больше обычного, станет тесно ${when}.`;
  }
  const hasMeasure = dc.m.length > 0;
  const quiet = lv.quiet && !state.showAll;
  const entry = getEntry(day.date, t);

  if (quiet) {
    const peak = Math.round(d3.max(ctx.pts, p => p.plan));
    node.innerHTML = `<div class="quiet-note"><b>Меры не нужны.</b> Самый полный состав в ближайшие 2 часа: до ${fmt(peak)} человек при норме ${fmt(meta.c.norm)}.
      ${hasMeasure ? `<br>${plain(dc.m[0].text)}.` : ""}
      <div class="rec-actions"><button class="btn" id="p-showall">Показать подробности</button></div></div>`;
    document.getElementById("p-showall").onclick = () => { state.showAll = true; ctx.redraw(); };
    return;
  }

  const ms = hasMeasure ? dc.m.map(m => `
    <li class="measure"><div class="ic" style="${m.type === "add" ? "background:var(--ink);color:var(--paper)" : ""}">${ICON[m.type]}</div>
    <div><b>${plain(m.text)}</b><span>${plain(m.why)}</span></div></li>`).join("")
    : `<li class="measure"><div class="ic">✓</div><div><b>Работать по графику</b><span>менять ничего не нужно</span></div></li>`;
  // сколько машинистов-часов добавляет совет: лишние пары за те же 15-минутные отрезки × оборот (99 мин)
  const extraH = d3.sum(dc.m.filter(m => m.type === "hold" || m.type === "add"), m =>
    d3.sum(d3.range(m.from, m.to + 1), k => Math.max(0, day.sys[k] - day.plan[k])) * 0.25 * meta.c.turnover / 60);
  const needCrew = extraH > 0.05;
  const crewNote = needCrew ? `≈${dec(extraH)} машинисто-ч сверх графика, данных о сменах нет` : "данных о сменах нет";
  const checks = dc.ck ? `<ul class="checks">${dc.ck.map(c => { const [r, n] = checkText(c); return `<li><span class="${c.ok ? "y" : "n"}">${c.ok ? "✓" : "✕"}</span><span>${r}</span><em>${n}</em></li>`; }).join("")}
    <li><span class="q">?</span><span>Смены машинистов</span><em>${crewNote}</em></li></ul>` : "";
  const P = day.sys[t + 1], trains = Math.round(P * meta.c.turnover / 60);
  let gain = "";
  if (w && (w.sector === "north" || w.sector === "south") && dc.m.some(m => m.type === "hold" || m.type === "add")) {
    const ks = d3.range(w.from, w.to + 1);
    const over = (L, pp) => d3.sum(ks, k => Math.max(L[k] - meta.c.norm, 0) * pp[k] / 4);
    const a = day.load_plan[w.sector], b = day.load_sys[w.sector];
    const oa = over(a, day.plan), ob = over(b, day.sys);
    const pa = d3.max(ks, k => a[k]), pb = d3.max(ks, k => b[k]);
    if (oa > 0 && ob < oa * 0.97) gain = `<div class="gain"><p class="kicker" style="margin:0 0 6px">Если выполнить совет</p>
      <div class="gain-row"><div><span class="num">${fmt(oa)}</span> → <b class="num">${fmt(ob)}</b><small>людей едут в тесноте сверх нормы</small></div>
      ${pb < pa - 10 ? `<div><span class="num">${fmt(pa)}</span> → <b class="num">${fmt(pb)}</b><small>человек в самом полном составе</small></div>` : `<div><b class="num">−${Math.round((1 - ob / oa) * 100)}%</b><small>тесноты с ${slotStr(w.from)} до ${slotStr(w.to + 1)}</small></div>`}</div></div>`;
  }

  let actions = "";
  if (hasMeasure) {
    if (entry) actions = `<div class="rec-done"><span>${ACT[entry.act]} в ${slotStr(t + 1)}${entry.reason ? `: ${entry.reason.toLowerCase()}` : ""}. Записано в журнал.</span><button id="p-undo">Отменить</button></div>`;
    else if (state.ui === "confirm") actions = `<div class="rec-confirm"><p>Подтвердите, что берёте в работу:</p>
      <ul>${dc.m.map(m => `<li>${plain(m.text)}</li>`).join("")}</ul>
      ${needCrew ? `<label class="crew-ok"><input type="checkbox" id="p-crew"> Смены машинистов проверил по графику бригад: на ≈${dec(extraH)} машинисто-ч сверх графика людей хватает</label>` : ""}
      <div class="rec-actions" style="margin:0"><button class="btn solid" id="p-yes" ${needCrew ? "disabled" : ""}>Подтвердить</button><button class="btn" id="p-no">Назад</button></div></div>`;
    else if (state.ui === "reject") actions = `<div class="rec-confirm"><p>Почему не нужно?</p><div class="rec-reasons">${REASONS.map((r, i) => `<button class="btn" data-r="${i}">${r}</button>`).join("")}</div>
      <div class="rec-actions" style="margin-bottom:0"><button class="btn" id="p-no">Назад</button></div></div>`;
    else actions = `<div class="rec-actions"><button class="btn solid" id="p-accept">Принять</button><button class="btn" id="p-defer">Отложить на 15 минут</button><button class="btn" id="p-reject">Не нужно</button></div>`;
  }

  node.innerHTML = `
    <div class="verdict">
      <span class="status" style="color:${st.c}"><span class="dot" style="background:${st.c}"></span>${st.label}</span>
      <div class="head">${head}</div>
      <p class="why">${why}</p>
    </div>
    <p class="kicker" style="margin:16px 0 0">Что сделать</p>
    <ul class="measures">${ms}</ul>
    ${actions}
    ${gain}
    ${checks ? `<p class="kicker" style="margin:16px 0 0">Можно ли это сделать</p>${checks}` : ""}
    <div class="linestate"><span>Линия сейчас:</span><span>составов на линии <b>${trains}</b> из ${meta.c.max_trains}</span><span><b>${dec(P, 0)}</b> ${pl(P, "пара", "пары", "пар")} в час, можно до ${Math.floor(meta.c.max_pairs)}</span></div>
    ${lv.quiet ? `<div class="rec-actions"><button class="btn" id="p-hideall">Свернуть</button></div>` : ""}`;

  const $ = id => document.getElementById(id), ui = v => { state.ui = v; ctx.redraw(); };
  if ($("p-hideall")) $("p-hideall").onclick = () => { state.showAll = false; ctx.redraw(); };
  if ($("p-accept")) $("p-accept").onclick = () => ui("confirm");
  if ($("p-no")) $("p-no").onclick = () => ui(null);
  if ($("p-reject")) $("p-reject").onclick = () => ui("reject");
  if ($("p-crew")) $("p-crew").onchange = e => { $("p-yes").disabled = !e.target.checked; };
  if ($("p-yes")) $("p-yes").onclick = () => {
    setEntry(day.date, t, { act: "accept", crew: needCrew, m: dc.m.map(m => plain(m.text)) });
    state.ui = null; ctx.redraw();
    toast("Принято. Решение записано в журнал.", () => { clearEntry(day.date, t); ctx.redraw(); });
  };
  if ($("p-defer")) $("p-defer").onclick = () => {
    setEntry(day.date, t, { act: "defer", m: dc.m.map(m => plain(m.text)) });
    state.t = Math.min(87, t + 1); state.ui = null; ctx.redraw();
  };
  node.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    setEntry(day.date, t, { act: "reject", reason: REASONS[+b.dataset.r], m: dc.m.map(m => plain(m.text)) });
    state.ui = null; ctx.redraw();
  });
  if ($("p-undo")) $("p-undo").onclick = () => { clearEntry(day.date, t); ctx.redraw(); };
}

/* короткая плашка с отменой на 10 секунд */
function toast(text, onUndo) {
  document.querySelector(".toast")?.remove(); clearTimeout(state.toast);
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status");
  el.innerHTML = `<span>${text}</span><button>Отменить (10 с)</button>`;
  el.querySelector("button").onclick = () => { el.remove(); clearTimeout(state.toast); onUndo(); };
  document.body.appendChild(el);
  state.toast = setTimeout(() => el.remove(), 10000);
}

const cap = s => s[0].toUpperCase() + s.slice(1);

const more = r => Math.abs(r) < 0.03 ? "как обычно" : `на ${Math.round(Math.abs(r) * 100)}% ${r > 0 ? "больше" : "меньше"} обычного`;

function checkText(c) {
  if (c.rule.startsWith("Запас по интервалу")) {
    const m = c.note.match(/(\d+) из ([\d,]+)/);
    return ["Можно ли пустить составы чаще", m ? (c.ok ? `да, сейчас ${m[1]} в час, предел ${Math.floor(+m[2].replace(",", "."))}` : `нет, уже ${m[1]} в час, это предел`) : c.note];
  }
  if (c.rule.startsWith("Свободные составы")) return ["Есть ли свободные составы", c.note.replace("на линии", "на линии уже")];
  if (c.rule.startsWith("Резерв успевает")) {
    const m = c.note.match(/(\d+) мин до начала, выход (\d+)–(\d+)/);
    return ["Успеет ли резерв из депо", m ? `до тесноты ${m[1]} мин, выезд ${m[2]}–${m[3]} мин` : c.note];
  }
  return [c.rule, c.note];
}
