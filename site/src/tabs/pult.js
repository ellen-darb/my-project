import * as d3 from "d3";
import { load, fmt, sgnPct, hhmm, slotStr, dayLong, weekday, weekdayS, parseDay, monthName, SCHED_TITLE,
  forecastEntries, tipShow, tipHide, loadColor, dec } from "../lib/util.js";
import { drawMarey } from "../lib/marey.js";
import { drawLineMap, mapColor } from "../lib/linemap.js";
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
  structural: { c: "var(--amber)", label: "Перегрузка по графику" },
  anomaly: { c: "var(--red)", label: "Нештатный поток" },
  low: { c: "var(--blue)", label: "Поток ниже обычного" },
};
const ICON = { hold: "=", add: "+", cut: "−", limit: "!", watch: "i" };
const SECT = { north: "Север → центр", south: "Юг → центр", line: "Вся линия" };
const GROUP = { "mon-thu": "будний день", fri: "пятница", sat: "суббота", sun: "воскресенье или праздник" };

let state = { d: "2026-09-15", t: 28, mode: "sys", off: 0, timer: null };

export async function render(app, params) {
  if (params.get("d")) state.d = params.get("d");
  if (params.get("t")) state.t = +params.get("t");
  const [meta, days, fcst] = await Promise.all([load("meta.json"), load("days.json"), load("forecast.json")]);
  let seen = false;
  try { seen = localStorage.getItem("takt-hint") === "1"; } catch (e) { /* хранилище недоступно */ }
  app.innerHTML = `
  ${seen ? "" : `<div class="hint" id="p-hint"><div><b>Реальный день по турникетам.</b> Слева схема линии: чем толще и краснее линия, тем теснее в составах. Справа совет диспетчеру. Нажмите «Проиграть».</div><button class="btn" id="p-hint-x">Понятно</button></div>`}
  <div class="pult-head">
    <div class="pult-day"><p class="kicker">Пульт диспетчера · линия 1 · проигрывание реального дня</p><h1 id="p-day"></h1><div class="meta" id="p-meta"></div><button class="btn" id="p-csv" hidden style="margin-top:10px">Скачать рекомендации дня, CSV</button></div>
    <div class="clock"><small>Сейчас</small><span id="p-clock"></span></div>
    <div class="transport">
      <div class="tbtns"><button class="btn solid" id="p-play" aria-label="Проиграть">▶ Проиграть</button>
      <button class="btn" id="p-back" aria-label="Назад на 15 минут">−15</button>
      <button class="btn" id="p-fwd" aria-label="Вперёд на 15 минут">+15</button></div>
      <input type="range" id="p-range" min="24" max="87" step="1" aria-label="Время">
    </div>
  </div>
  <div class="rail-wrap"><div class="rail-lbl">Решения за день</div><div class="rail" id="p-rail"></div></div>
  <div class="pult-grid">
    <div class="left">
      <div class="chart-title">
        <h3 id="p-map-t">Линия 1 сейчас</h3>
        <div class="seg" id="p-off">${[0, 30, 60, 90, 120].map(o => `<button data-o="${o}">${o ? `+${o}<span class="u"> мин</span>` : "Сейчас"}</button>`).join("")}</div>
      </div>
      <div class="lm-legend">
        <span class="lm-k"><b>Линия</b> — человек в составе к центру</span>
        <span class="lm-scale"><span>свободно</span><span class="scale" id="p-scale"></span><span>битком</span></span>
        <span class="lm-k"><b>Полоска</b> — вошло за час, черта — сколько обычно</span>
      </div>
      <div id="p-map"></div>
      <div class="seg" id="p-mode" style="margin-top:14px"><button data-m="plan">По графику</button><button data-m="sys">С советами Такта</button></div>
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
    <div class="chart-title"><h3>Выберите день: 120 дней с турникетами по 15 минут</h3>
      <span class="legend"><span>цвет — пассажиры сверх нормы за день по графику</span><span class="scale" id="p-dscale"></span></span></div>
    <div class="months" id="p-months"></div>
    <div class="presets" id="p-presets"></div>
  </div>`;

  // шкалы легенды
  const sc = d3.select("#p-scale");
  d3.range(0, 1459, 40).forEach(v => sc.append("span").style("flex", 1).style("background", mapColor(v)));
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
  const hx = document.getElementById("p-hint-x");
  if (hx) hx.onclick = () => { document.getElementById("p-hint").remove(); try { localStorage.setItem("takt-hint", "1"); } catch (e) { /* без хранилища */ } };
  // выгрузка рекомендаций дня: только там, где страница может предложить файл
  const csvBtn = document.getElementById("p-csv");
  if (window.claude?.use) window.claude.use("downloads").then(dl => {
    if (!dl || !document.body.contains(csvBtn)) return;
    csvBtn.hidden = false;
    csvBtn.onclick = async () => {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const rows = [["Время", "Состояние", "Поток за час к обычному", "Мера", "Почему"]];
      for (const e of day.dec) {
        const st = STATUS[e.s]?.label || e.s, lr = sgnPct(e.lr - 1);
        if (!e.m.length) rows.push([slotStr(e.t), st, lr, "по графику", ""]);
        for (const m of e.m) rows.push([slotStr(e.t), st, lr, m.text, m.why]);
      }
      const csv = "\ufeff" + rows.map(r => r.map(q).join(";")).join("\r\n");
      try { await dl.save({ filename: `takt-${state.d}.csv`, data: csv }); }
      catch (err) { if (["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(err?.code)) csvBtn.hidden = true; }
    };
  });
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
  document.querySelectorAll("#p-off button").forEach(b => b.onclick = () => { state.off = +b.dataset.o; draw(false); });
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
    drawRail(document.getElementById("p-rail"), day, t, tt => { state.t = tt; draw(false); });
    history.replaceState(null, "", `#pult?d=${state.d}&t=${t}`);
    document.getElementById("p-clock").textContent = slotStr(t + 1);
    document.querySelectorAll("#p-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === state.mode));

    const pairs = state.mode === "sys" ? day.sys : day.plan;
    const E = forecastEntries(day.x, day.b, t, meta.w_ratio);
    const entriesAt = s => (s <= t ? day.x[s] : E[s]);
    const off = state.off || 0, tm = (t + 1) * 15 + off;
    document.querySelectorAll("#p-off button").forEach(b => b.classList.toggle("on", +b.dataset.o === off));
    document.getElementById("p-map-t").innerHTML = off ? `Линия 1 в ${hhmm(tm)} <span class="lm-fc">прогноз</span>` : `Линия 1 сейчас, ${hhmm(tm)}`;
    drawLineMap(document.getElementById("p-map"), { meta, timeMin: tm, pairs, entriesAt, base: day.b });

    const dc = day.dec[t - 24];
    renderDecision(document.getElementById("p-dec"), dc, day, meta, t);

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
  return () => stop();
}

function drawRail(node, day, t, go) {
  if (node.dataset.d !== day.date) {
    node.dataset.d = day.date;
    node.innerHTML = day.dec.map(dc => {
      const m = dc.m.map(x => ICON[x.type]).join("");
      return `<button class="rail-c" data-t="${dc.t}" style="--c:${STATUS[dc.s].c}" aria-label="${slotStr(dc.t + 1)}: ${STATUS[dc.s].label}">${m ? `<b>${m[0]}</b>` : ""}</button>`;
    }).join("") + `<div class="rail-ax">${[7, 9, 12, 15, 18, 21].map(h => `<span style="left:${(h * 4 - 25 + 0.5) / 64 * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("")}</div>`;
    node.querySelectorAll(".rail-c").forEach(b => {
      const dc = day.dec[+b.dataset.t - 24];
      b.onclick = () => go(+b.dataset.t);
      b.onmouseenter = ev => tipShow(ev, `<b>${slotStr(dc.t + 1)}</b> · ${STATUS[dc.s].label}${dc.m.map(x => `<br>${x.text}`).join("")}`);
      b.onmouseleave = tipHide;
    });
  }
  node.querySelectorAll(".rail-c").forEach(b => b.classList.toggle("on", +b.dataset.t === t));
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
  let gain = "";
  if (w && (w.sector === "north" || w.sector === "south") && dc.m.some(m => m.type === "hold" || m.type === "add")) {
    const ks = d3.range(w.from, w.to + 1);
    const over = (L, pp) => d3.sum(ks, k => Math.max(L[k] - meta.c.norm, 0) * pp[k] / 4);
    const a = day.load_plan[w.sector], b = day.load_sys[w.sector];
    const oa = over(a, day.plan), ob = over(b, day.sys);
    gain = `<div class="gain"><p class="kicker" style="margin:0 0 6px">Что дали меры в этот день</p>
      <div class="gain-row"><div><span class="num">${fmt(d3.max(ks, k => a[k]))}</span> → <b class="num">${fmt(d3.max(ks, k => b[k]))}</b><small>пик, чел. в составе</small></div>
      <div><span class="num">${fmt(oa)}</span> → <b class="num">${fmt(ob)}</b><small>пассажиров сверх нормы за окно</small></div></div>
      <p class="note" style="margin:6px 0 0">По фактическому потоку этого дня, ${slotStr(w.from)}–${slotStr(w.to + 1)}.</p></div>`;
  }
  node.innerHTML = `
    <div class="verdict">
      <span class="status" style="color:${st.c}"><span class="dot" style="background:${st.c}"></span>${st.label}</span>
      <div class="head">${head}</div>
      <p class="why">${why}</p>
    </div>
    <p class="kicker" style="margin:16px 0 0">Что сделать</p>
    <ul class="measures">${ms}</ul>
    ${gain}
    ${checks ? `<p class="kicker" style="margin:16px 0 0">Ограничения линии</p>${checks}` : ""}
    <div class="linestate"><span>Линия сейчас:</span><span><b>${sgnPct(dc.lr - 1)}</b> поток за час к обычному</span><span><b>${trains}</b> из ${meta.c.max_trains} составов</span><span><b>${dec(P, 0)}</b> пар/ч из ${dec(meta.c.max_pairs)}</span></div>`;
}

const cap = s => s[0].toUpperCase() + s.slice(1);
