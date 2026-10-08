import * as d3 from "d3";
import { load, fmt, sgnPct, hhmm, slotStr, dayLong, weekday, weekdayS, parseDay, monthName, SCHED_TITLE,
  forecastEntries, tipShow, tipHide, loadColor, dec } from "../lib/util.js";
import { drawMarey } from "../lib/marey.js";
import { sectorChart, pairsChart } from "../lib/charts.js";

const PRESETS = [
  { d: "2026-09-15", t: 28, label: "15.09 · самое тяжёлое утро" },
  { d: "2026-02-26", t: 27, label: "26.02 · поток выше обычного" },
  { d: "2026-05-08", t: 64, label: "08.05 · канун праздника, линия на пределе" },
  { d: "2026-07-21", t: 40, label: "21.07 · летом поток ниже, можно снять" },
  { d: "2026-09-12", t: 52, label: "12.09 · суббота, всплеск у Пл. Восстания" },
];

const STATUS = {
  ok: { c: "var(--green)", label: "Составов хватает" },
  structural: { c: "var(--amber)", label: "Перегрузка по графику" },
  anomaly: { c: "var(--red)", label: "Нештатный поток" },
  low: { c: "var(--blue)", label: "Поток ниже обычного" },
};
const ICON = { hold: "=", add: "+", cut: "−", limit: "!", watch: "i" };
const SECT = { north: "Север → центр", south: "Юг → центр", line: "Вся линия" };
const GROUP = { "mon-thu": "будний день", fri: "пятница", sat: "суббота", sun: "воскресенье или праздник" };

let state = { d: "2026-09-15", t: 28, mode: "sys", timer: null };

export async function render(app, params) {
  if (params.get("d")) state.d = params.get("d");
  if (params.get("t")) state.t = +params.get("t");
  const [meta, days, fcst] = await Promise.all([load("meta.json"), load("days.json"), load("forecast.json")]);
  app.innerHTML = `
  <div class="pult-head">
    <div class="pult-day"><p class="kicker">Пульт диспетчера · линия 1 · проигрывание реального дня</p><h1 id="p-day"></h1><div class="meta" id="p-meta"></div></div>
    <div class="clock"><small>Сейчас</small><span id="p-clock"></span></div>
    <div class="transport">
      <button class="btn solid" id="p-play" aria-label="Проиграть">▶ Проиграть</button>
      <button class="btn" id="p-back" aria-label="Назад на 15 минут">−15</button>
      <input type="range" id="p-range" min="24" max="87" step="1" aria-label="Время">
      <button class="btn" id="p-fwd" aria-label="Вперёд на 15 минут">+15</button>
    </div>
  </div>
  <div class="pult-grid">
    <div class="left">
      <div class="chart-title">
        <h3>График движения и загрузка составов: час назад и два часа вперёд</h3>
        <div class="seg" id="p-mode"><button data-m="plan">По графику</button><button data-m="sys">С мерами Такта</button></div>
      </div>
      <div class="legend" style="margin-bottom:6px">
        <span>чел. в составе к центру:</span>
        <span>0<span class="scale" id="p-scale"></span>1 458</span>
        <span><i style="background:var(--unknown)"></i>центр и выезд: по турникетам не оценить</span>
      </div>
      <div id="p-marey"></div>
      <p class="note">Нитки построены по парности листа «График оборота составов» (время хода 46 мин в одну сторону), а не по точному расписанию. Загрузка: 85% вошедших на станциях сектора едут к центру; составов за 15 минут — парность / 4.</p>
    </div>
    <div class="right" id="p-dec"></div>
  </div>
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
  <div class="daystrip">
    <div class="chart-title"><h3>Выберите день: 120 дней с поминутными турникетами</h3>
      <span class="legend"><span>цвет — пассажиры сверх нормы за день по графику</span><span class="scale" id="p-dscale"></span></span></div>
    <div class="months" id="p-months"></div>
    <div class="presets" id="p-presets"></div>
  </div>`;

  // шкалы легенды
  const sc = d3.select("#p-scale");
  d3.range(0, 1459, 40).forEach(v => sc.append("span").style("flex", 1).style("background", loadColor(v)));
  const maxOver = d3.max(days, d => d.over);
  const dcol = v => v <= 0 ? "var(--rule-2)" : d3.interpolateRgb("#F6D3CF", "#8A0026")(Math.sqrt(v / maxOver));
  const ds = d3.select("#p-dscale");
  d3.range(0, 1.01, 0.05).forEach(v => ds.append("span").style("flex", 1).style("background", dcol(v * maxOver)));

  // календарь дней
  const byMonth = d3.group(days, d => parseDay(d.d).getMonth() + 1);
  const months = document.getElementById("p-months");
  for (const [m, list] of byMonth) {
    const row = document.createElement("div"); row.className = "month";
    row.innerHTML = `<div class="lbl">${monthName(m)}</div><div class="cells"></div>`;
    const cells = row.querySelector(".cells");
    for (const d of list) {
      const b = document.createElement("button");
      const dn = parseDay(d.d).getDate();
      b.className = "cell" + (d.sched === "weekend" ? " we" : "") + (d.over > maxOver * 0.35 ? " dark" : "");
      b.style.gridColumn = dn; b.style.background = dcol(d.over); b.textContent = dn; b.dataset.d = d.d;
      b.setAttribute("aria-label", `${dayLong(d.d)}, сверх нормы ${fmt(d.over)} чел.`);
      b.onmouseenter = ev => tipShow(ev, `<b>${dayLong(d.d)}, ${weekdayS(d.d)}</b><br>вошло ${fmt(d.entries)} · ${sgnPct(d.ratio - 1)} к обычному<br>пик к центру: север ${fmt(d.peak.north)}, юг ${fmt(d.peak.south)}<br>сверх нормы по графику: <b>${fmt(d.over)}</b>, с мерами ${fmt(d.over_sys)}`);
      b.onmouseleave = tipHide;
      b.onclick = () => { state.d = d.d; draw(true); };
      cells.appendChild(b);
    }
    months.appendChild(row);
  }
  const pr = document.getElementById("p-presets");
  for (const p of PRESETS) {
    const b = document.createElement("button"); b.className = "btn"; b.textContent = p.label;
    b.onclick = () => { state.d = p.d; state.t = p.t; draw(true); };
    pr.appendChild(b);
  }

  const range = document.getElementById("p-range");
  range.oninput = () => { state.t = +range.value; draw(false); };
  document.getElementById("p-back").onclick = () => { state.t = Math.max(24, state.t - 1); draw(false); };
  document.getElementById("p-fwd").onclick = () => { state.t = Math.min(87, state.t + 1); draw(false); };
  const play = document.getElementById("p-play");
  play.onclick = () => {
    if (state.timer) { stop(); return; }
    play.textContent = "❚❚ Пауза";
    state.timer = setInterval(() => {
      if (state.t >= 87) { stop(); return; }
      state.t++; draw(false);
    }, 900);
  };
  function stop() { clearInterval(state.timer); state.timer = null; play.textContent = "▶ Проиграть"; }
  document.querySelectorAll("#p-mode button").forEach(b => b.onclick = () => { state.mode = b.dataset.m; draw(false); });

  let day = null;
  async function draw(newDay) {
    if (newDay || !day || day.date !== state.d) {
      day = await load(`day/${state.d}.json`);
      const info = days.find(x => x.d === state.d);
      document.getElementById("p-day").textContent = `${cap(weekday(state.d))}, ${dayLong(state.d)} 2026`;
      document.getElementById("p-meta").innerHTML = `${SCHED_TITLE[day.sched]} · за день вошло ${fmt(info.entries)}, ${sgnPct(info.ratio - 1)} к обычному дню (${GROUP[day.group]})`;
      document.querySelectorAll(".cell").forEach(c => c.classList.toggle("sel", c.dataset.d === state.d));
    }
    const t = state.t;
    range.value = t;
    history.replaceState(null, "", `#pult?d=${state.d}&t=${t}`);
    document.getElementById("p-clock").textContent = slotStr(t + 1);
    document.querySelectorAll("#p-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === state.mode));

    const pairs = state.mode === "sys" ? day.sys : day.plan;
    const E = forecastEntries(day.x, day.b, t, meta.w_ratio);
    const entriesAt = s => (s <= t ? day.x[s] : E[s]);
    drawMarey(document.getElementById("p-marey"), { day, meta, nowMin: (t + 1) * 15, pairs, entriesAt,
      height: innerWidth < 640 ? 460 : 540 });

    const dc = day.dec[t - 24];
    renderDecision(document.getElementById("p-dec"), dc, day, meta, t);

    const band = d3.range(1, 9).map(h => [fcst.q[h * 15][1], fcst.q[h * 15][3]]);
    const compact = innerWidth < 640;
    for (const s of ["north", "south"]) {
      sectorChart(document.getElementById(`p-${s}`), { title: SECT[s], typ: day.load_typ[s], fact: day.load_plan[s],
        sys: day.load_sys[s], fc: dc.fc[s], band, t, norm: meta.c.norm, maxTrain: meta.c.max_train, compact });
    }
    pairsChart(document.getElementById("p-pairs"), { plan: day.plan, sys: day.sys, t, maxPairs: meta.c.max_pairs, height: 170, compact });
  }
  await draw(true);
  return () => stop();
}

function renderDecision(node, dc, day, meta, t) {
  const st = STATUS[dc.s];
  const w = dc.w;
  let head, why;
  if (dc.s === "ok") {
    head = "В ближайшие 2 часа загрузка ниже нормы";
    why = `Поток на линии за последний час ${sgnPct(dc.lr - 1)} к обычному дню. Корректировка не нужна.`;
  } else if (dc.s === "low") {
    head = `Поток ${sgnPct(dc.lr - 1)} к обычному дню`;
    why = "Загрузка остаётся ниже 70% нормы, можно снять составы без выхода за максимальный интервал графика.";
  } else {
    const sec = SECT[w.sector];
    head = w.sector === "line" ? `Поток на линии ${sgnPct(dc.lr - 1)} к обычному дню`
      : `${sec}: до ${fmt(w.peak)} чел. в составе ${slotStr(w.from)}–${slotStr(w.to + 1)}`;
    why = dc.s === "structural"
      ? `Поток обычный (${sgnPct(dc.lr - 1)}), но парности графика не хватает: норма ${fmt(meta.c.norm)}. Начало через ${w.lead_min} мин.`
      : `Поток выше обычного, перегрузка через ${w.lead_min} мин.`;
  }
  const ms = dc.m.length ? dc.m.map(m => `
    <li class="measure"><div class="ic" style="${m.type === "add" ? "background:var(--ink);color:var(--paper)" : ""}">${ICON[m.type]}</div>
    <div><b>${m.text}</b><span>${m.why}</span></div></li>`).join("")
    : `<li class="measure"><div class="ic">✓</div><div><b>Действовать по графику</b><span>меры не нужны</span></div></li>`;
  const checks = dc.ck ? `<ul class="checks">${dc.ck.map(c => `<li><span class="${c.ok ? "y" : "n"}">${c.ok ? "✓" : "✕"}</span><span>${c.rule}</span><em>${c.note}</em></li>`).join("")}</ul>` : "";
  const P = day.sys[t + 1], trains = Math.round(P * meta.c.turnover / 60);
  node.innerHTML = `
    <div class="verdict">
      <span class="status" style="color:${st.c}"><span class="dot" style="background:${st.c}"></span>${st.label}</span>
      <div class="head">${head}</div>
      <p class="why">${why}</p>
    </div>
    <p class="kicker" style="margin:16px 0 0">Что сделать</p>
    <ul class="measures">${ms}</ul>
    ${checks ? `<p class="kicker" style="margin:16px 0 0">Ограничения линии</p>${checks}` : ""}
    <div class="facts">
      <div class="fact"><div class="v">${sgnPct(dc.lr - 1)}</div><div class="k">поток за час к обычному дню</div></div>
      <div class="fact"><div class="v">${trains}<small style="font-size:16px;color:var(--ink-3)"> / ${meta.c.max_trains}</small></div><div class="k">составов на линии</div></div>
      <div class="fact"><div class="v">${dec(P, 0)}</div><div class="k">пар в час, предел ${dec(meta.c.max_pairs)}</div></div>
      <div class="fact"><div class="v">${fmt(Math.max(...dc.fc.north))}</div><div class="k">макс. к центру с севера за 2 ч</div></div>
    </div>`;
}

const cap = s => s[0].toUpperCase() + s.slice(1);
