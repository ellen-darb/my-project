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
  ok: { c: "var(--green)", label: "Поездов хватает" },
  structural: { c: "var(--amber)", label: "Тесно по графику" },
  anomaly: { c: "var(--red)", label: "Людей больше обычного" },
  low: { c: "var(--blue)", label: "Можно убрать поезда" },
};
const ICON = { hold: "=", add: "+", cut: "−", limit: "!", watch: "i" };
const SECT = { north: "С севера в центр", south: "С юга в центр", line: "Вся линия" };
const GROUP = { "mon-thu": "будний день", fri: "пятница", sat: "суббота", sun: "воскресенье или праздник" };

let state = { d: "2026-09-15", t: 28, mode: "sys", off: 0, timer: null };

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
    <div class="rail-key"><span><i style="background:var(--green)"></i>поездов хватает</span><span><i style="background:var(--amber)"></i>тесно по графику</span><span><i style="background:var(--red)"></i>людей больше обычного</span><span><i style="background:var(--blue)"></i>можно убрать поезда</span></div></div>
  </div>
  <div class="pult-grid">
    <div class="left">
      <div class="chart-title">
        <h3 id="p-map-t">Линия 1 сейчас</h3>
        <div class="seg" id="p-mode"><button data-m="plan">Как по графику</button><button data-m="sys">Если выполнить совет</button></div>
      </div>
      <div class="seg" id="p-off" style="margin-bottom:12px">${[0, 30, 60, 90, 120].map(o => `<button data-o="${o}">${o ? `+${o}<span class="u"> мин</span>` : "Сейчас"}</button>`).join("")}</div>
      <div class="lm-legend">
        <span class="lm-k"><b>Линия</b> — сколько людей в поезде, который едет в центр</span>
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
  sel.onchange = () => { state.d = sel.value; draw(true); };
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
    b.onclick = () => { state.d = p.d; state.t = p.t; draw(true); };
    pr.appendChild(b);
  }

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
  function stop() { clearInterval(state.timer); state.timer = null; play.textContent = "▶ Проиграть день"; }
  document.querySelectorAll("#p-off button").forEach(b => b.onclick = () => { state.off = +b.dataset.o; draw(false); });
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

function renderDecision(node, dc, day, meta, t) {
  const st = STATUS[dc.s];
  const w = dc.w;
  let head, why;
  if (dc.s === "ok") {
    head = "Следующие 2 часа в поездах свободно";
    why = `Людей ${more(dc.lr - 1)}. Ничего менять не нужно.`;
  } else if (dc.s === "low") {
    head = `Людей ${more(dc.lr - 1)}`;
    why = "В поездах будет заполнено меньше 70% мест, часть поездов можно отправить в депо.";
  } else {
    head = w.sector === "line" ? `Людей ${more(dc.lr - 1)}`
      : `${SECT[w.sector]}: до ${fmt(w.peak)} человек в поезде с ${slotStr(w.from)} до ${slotStr(w.to + 1)}`;
    why = dc.s === "structural"
      ? `Людей как обычно, но поездов по графику мало: норма ${fmt(meta.c.norm)} человек в поезде. ${w.lead_min ? `Начнётся через ${w.lead_min} мин.` : "Уже сейчас."}`
      : `Людей больше обычного, станет тесно ${w.lead_min ? `через ${w.lead_min} мин` : "уже сейчас"}.`;
  }
  const ms = dc.m.length ? dc.m.map(m => `
    <li class="measure"><div class="ic" style="${m.type === "add" ? "background:var(--ink);color:var(--paper)" : ""}">${ICON[m.type]}</div>
    <div><b>${plain(m.text)}</b><span>${plain(m.why)}</span></div></li>`).join("")
    : `<li class="measure"><div class="ic">✓</div><div><b>Работать по графику</b><span>менять ничего не нужно</span></div></li>`;
  const checks = dc.ck ? `<ul class="checks">${dc.ck.map(c => { const [r, n] = checkText(c); return `<li><span class="${c.ok ? "y" : "n"}">${c.ok ? "✓" : "✕"}</span><span>${r}</span><em>${n}</em></li>`; }).join("")}</ul>` : "";
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
      ${pb < pa - 10 ? `<div><span class="num">${fmt(pa)}</span> → <b class="num">${fmt(pb)}</b><small>человек в самом полном поезде</small></div>` : `<div><b class="num">−${Math.round((1 - ob / oa) * 100)}%</b><small>тесноты с ${slotStr(w.from)} до ${slotStr(w.to + 1)}</small></div>`}</div></div>`;
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
    ${checks ? `<p class="kicker" style="margin:16px 0 0">Можно ли это сделать</p>${checks}` : ""}
    <div class="linestate"><span>Линия сейчас:</span><span>поездов на линии <b>${trains}</b> из ${meta.c.max_trains}</span><span><b>${dec(P, 0)}</b> ${pl(P, "поезд", "поезда", "поездов")} в час, можно до ${Math.floor(meta.c.max_pairs)}</span></div>`;
}

const cap = s => s[0].toUpperCase() + s.slice(1);

function pl(n, one, few, many) {
  n = Math.abs(Math.round(n)); const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
const more = r => Math.abs(r) < 0.03 ? "как обычно" : `на ${Math.round(Math.abs(r) * 100)}% ${r > 0 ? "больше" : "меньше"} обычного`;

/* тексты расчёта — языком диспетчерской, без «пар/ч» и сокращений */
function plain(t) {
  return t
    .replace("Составы не добавить: линия на пределе пропускной способности", "Добавить поезд нельзя: они уже идут с минимальным интервалом")
    .replace("предупредить станции сектора и подготовить регулирование входа на самых загруженных вестибюлях", "Предупредите станции участка: может понадобиться ограничить вход на самых загруженных")
    .replace("по графику парность снижается, а поток ещё выше нормы; составы уже на линии, ввод не нужен", "По графику поезда уходят в депо, а людей ещё больше нормы. Поезда уже на линии, их достаточно не уводить")
    .replace(/^Составы не добавлять: к центру до (\d[\d ]*) чел\. в составе \((\d+)% нормы\)/, "Добавлять поезда не нужно: в поезде до $1 человек, это $2% нормы")
    .replace("поток выше обычного, но на перегонах, где загрузку можно оценить, место есть; по центру — доклады дежурных станций", "Людей больше обычного, но в поездах есть место. По центру ориентируйтесь на доклады дежурных")
    .replace(/^поток (-?[−\d]+)% к обычному дню; загрузка остаётся ниже (\d+)% нормы, интервал в пределах графика/, (m, p, n) => `Людей на ${String(p).replace(/[-−]/, "")}% меньше обычного, поезда заполнены меньше чем на ${n}%`)
    .replace(/^резерв выходит за (\d+)–(\d+) мин и успевает/, "Резервный поезд выезжает за $1–$2 мин и успевает")
    .replace(/^перегрузка через (\d+) мин: резерв успеет только к (\d\d:\d\d)/, "Тесно станет через $1 мин, резерв успеет только к $2")
    .replace(/Не снимать составы до (\d\d:\d\d): держать (\d+) пар\/ч/, (m, h, n) => `Не уводить поезда в депо до ${h}: оставить ${n} ${pl(n, "поезд", "поезда", "поездов")} в час`)
    .replace(/Выпустить (\d+) сост\. раньше графика из депо ([^,]+), \+(\d+) пар\/ч/, (m, n, d, p) => `Выпустить ${n} ${pl(n, "поезд", "поезда", "поездов")} из депо ${d} раньше графика`)
    .replace(/Выдать (\d+) сост\. из резерва депо ([^,]+), \+(\d+) пар\/ч/, (m, n, d) => `Выпустить ${n} ${pl(n, "резервный поезд", "резервных поезда", "резервных поездов")} из депо ${d}`)
    .replace(/Снять (\d+) сост\. в депо, −(\d+) пар\/ч/, (m, n) => `Отправить ${n} ${pl(n, "поезд", "поезда", "поездов")} в депо`);
}

function checkText(c) {
  if (c.rule.startsWith("Запас по интервалу")) {
    const m = c.note.match(/(\d+) из ([\d,]+)/);
    return ["Можно ли пустить поезда чаще", m ? (c.ok ? `да, сейчас ${m[1]} в час, предел ${Math.floor(+m[2].replace(",", "."))}` : `нет, уже ${m[1]} в час, это предел`) : c.note];
  }
  if (c.rule.startsWith("Свободные составы")) return ["Есть ли свободные поезда", c.note.replace("на линии", "на линии уже")];
  if (c.rule.startsWith("Резерв успевает")) {
    const m = c.note.match(/(\d+) мин до начала, выход (\d+)–(\d+)/);
    return ["Успеет ли резерв из депо", m ? `до тесноты ${m[1]} мин, выезд ${m[2]}–${m[3]} мин` : c.note];
  }
  return [c.rule, c.note];
}
