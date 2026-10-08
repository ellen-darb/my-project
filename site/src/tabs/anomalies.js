import * as d3 from "d3";
import { load, fmt, pct, sgnPct, dayLong, weekdayS, parseDay, monthName, tipShow, tipHide, width, css, slotStr } from "../lib/util.js";

const KIND = { surge: "поток выше обычного", drop: "поток ниже обычного", incident: "станция потеряла вход" };
let sel = "2026-08-31";

export async function render(app, params) {
  if (params.get("d")) sel = params.get("d");
  const [meta, cal, eco, hourly, days] = await Promise.all([load("meta.json"), load("calendar.json"), load("economics.json"), load("hourly.json"), load("days.json")]);
  const A = eco.anomaly, S = eco.anomaly_sens;
  const lbl = A.rate;
  app.innerHTML = `
  <div class="lede"><div>
    <p class="kicker">Аномалии · январь–сентябрь 2026, почасовой файл турникетов</p>
    <h1>Около ${Math.round(A.per_year)} дней в году поток идёт не так, как рассчитан график</h1>
    <p class="sub">Аномалия — то, что нельзя заложить в график заранее: сбой, закрытие станции, погода, неожиданный всплеск. Праздники, кануны праздников и рост потока перед 1 сентября — плановые и сюда не входят. Мероприятие у одной станции тоже не аномалия: на календаре оно отмечено отдельно.</p>
  </div></div>

  <div class="section">
    <p class="statline">За девять месяцев — <b>${A.anomalous_days}</b> аномальных дней из ${A.unplanned_days} неплановых: поток два часа подряд на 12% выше или ниже обычного по линии или сектору. В пересчёте на год это <b>${Math.round(A.per_year)}</b> дней; при пороге 15% — ${S[2].per_year}, при 10% — ${S[0].per_year}. В выходные поток скачет сильнее: аномальны <b>${pct(lbl.weekend.surge + lbl.weekend.drop)}</b> выходных против ${pct(lbl.weekday.surge + lbl.weekday.drop)} будних.</p>
  </div>

  <div class="section">
    <div class="chart-title"><h3>Календарь: отклонение дневного потока 07–22 ч от обычного дня</h3>
      <div class="legend"><span>ниже</span><span class="scale" id="an-scale"></span><span>выше</span>
      <span>▲ ▼ аномалия</span><span>✕ станция без входа</span><span><u style="text-decoration-style:dotted">12</u> всплеск у одной станции</span><span><i style="background:var(--rule);height:10px"></i>плановый день</span></div></div>
    <div id="an-cal"></div>
  </div>

  <div class="section" id="an-day"></div>`;

  const sc = d3.select("#an-scale");
  const col = v => d3.interpolateRgb(v < 0 ? "#2F5DA8" : "#D6083B", "#ECE9E2")(1 - Math.min(1, Math.abs(v) / 0.25));
  d3.range(-0.25, 0.26, 0.025).forEach(v => sc.append("span").style("flex", 1).style("background", col(v)));

  const calNode = document.getElementById("an-cal");
  const byM = d3.group(cal, c => parseDay(c.d).getMonth() + 1);
  calNode.innerHTML = `<div class="months">${[...byM].map(([m, list]) => `
    <div class="month"><div class="lbl">${monthName(m)}</div><div class="cells">${list.map(c => {
      const dn = parseDay(c.d).getDate();
      const mark = c.planned ? "" : c.incident?.length ? "✕" : c.kinds.includes("surge") ? "▲" : c.kinds.includes("drop") ? "▼" : "";
      const loc = !c.planned && !mark && c.local?.length;
      const bg = c.planned ? "var(--rule)" : col(c.dev);
      const dark = !c.planned && Math.abs(c.dev) > 0.13;
      return `<button class="cell${dark ? " dark" : ""}${loc ? " loc" : ""}${c.d === sel ? " sel" : ""}" data-d="${c.d}" style="grid-column:${dn};background:${bg}">${mark ? `<span class="mk">${mark}</span>` : dn}</button>`;
    }).join("")}</div></div>`).join("")}</div>`;
  calNode.querySelectorAll(".cell").forEach(b => {
    const c = cal.find(x => x.d === b.dataset.d);
    b.onmouseenter = ev => tipShow(ev, `<b>${dayLong(c.d)}, ${weekdayS(c.d)}</b><br>за день ${sgnPct(c.dev)} к обычному${c.planned ? "<br>плановый день (праздник или канун)" : ""}${c.kinds.map(k => `<br>${KIND[k]}`).join("")}${c.incident?.length ? `<br>${c.incident[0][0]}, ${c.incident[0][1]}:00 — ${pct(c.incident[0][2])} обычного` : ""}${!c.kinds.length && c.local?.length ? `<br><span class="muted">всплеск: ${c.local[0][0]}, ${c.local[0][1]}:00</span>` : ""}`);
    b.onmouseleave = tipHide;
    b.onclick = () => { sel = c.d; calNode.querySelectorAll(".cell").forEach(x => x.classList.toggle("sel", x.dataset.d === sel)); drawDay(); history.replaceState(null, "", `#anomalies?d=${sel}`); };
  });

  function drawDay() {
    const j = hourly.days.indexOf(sel);
    const c = cal.find(x => x.d === sel);
    const X = hourly.x[j], B = hourly.b[j];
    const node = document.getElementById("an-day");
    node.innerHTML = `
      <div class="sec-head"><div><p class="kicker">${weekdayS(sel)} · ${c.planned ? "плановый день" : c.kinds.length ? "аномалия" : "обычный день"}</p><h2>${dayLong(sel)}: ${sgnPct(c.dev)} к обычному</h2></div>
      <p>${describe(c)}</p></div>
      ${taktBox(days.find(x => x.d === sel))}
      <div class="chart-title"><h3>Вход по станциям и часам к обычному дню</h3><span class="note">станции с юга (внизу) на север (вверху), как на схеме · <i class="sw" style="background:#2F5DA8"></i> на 60% ниже обычного … <i class="sw" style="background:#ECE9E2"></i> как обычно … <i class="sw" style="background:#D6083B"></i> на 60% выше</span></div>
      <div id="an-heat"></div>`;
    heat(document.getElementById("an-heat"), X, B, meta.stations);
  }
  drawDay();
}

const MEAS = { hold: "удержать", add: "добавить", cut: "снять", limit: "предупредить станции" };
function taktBox(d) {
  if (!d) return `<div class="an-takt muted">Для этого дня есть только почасовые данные. Проиграть его на пульте можно для февраля, мая, июля и сентября — там турникеты по 15 минут.</div>`;
  const kinds = Object.entries(d.n).filter(([, v]) => v > 0).sort((a, b) => d.first[a[0]] - d.first[b[0]]);
  const t0 = Object.values(d.first).length ? Math.min(...Object.values(d.first)) : 32;
  const what = kinds.length
    ? kinds.map(([k, v]) => `«${MEAS[k]}» с ${slotStr(d.first[k])}, рекомендаций: ${v}`).join("; ")
    : "";
  const over = d.over ? `Пассажиров сверх нормы по графику ${fmt(d.over)}, с мерами Такта ${fmt(d.over_sys)}.` : "Сверх нормы пассажиров не было.";
  return `<div class="an-takt"><div><b>Что предложил Такт</b><p>${kinds.length ? what : "Мер не было"}. ${over}</p></div><a class="btn" href="#pult?d=${d.d}&t=${t0}">Открыть на пульте</a></div>`;
}

function describe(c) {
  const parts = [];
  if (c.incident?.length) parts.push(`${c.incident[0][0]} в ${c.incident[0][1]}:00 приняла ${pct(c.incident[0][2])} обычного потока — похоже на закрытие входа или сбой. Люди ушли на соседние станции и в другие часы.`);
  if (c.kinds.includes("surge")) parts.push(`Поток выше обычного на 12%+ два часа подряд: ${c.surge.map(s => ({ line: "линия", north: "север", south: "юг" })[s]).join(", ")}.`);
  if (c.kinds.includes("drop")) parts.push(`Поток ниже обычного на 12%+ два часа подряд: ${c.drop.map(s => ({ line: "линия", north: "север", south: "юг" })[s]).join(", ")}. Снять составы Такт предлагает, только если поток ниже обычного на 15%+ и загрузка ниже 70% нормы.`);
  if (c.season) parts.push("Рост перед 1 сентября: возвращение к учебному ритму, плановое.");
  if (c.note) parts.push("Повтор закрытия на той же станции в те же часы несколько дней подряд — плановые работы, не аномалия.");
  if (!parts.length && c.local?.length) parts.push(`Всплеск у станции ${c.local[0][0]} около ${c.local[0][1]}:00 при обычной линии — так выглядит мероприятие. Это плановое событие.`);
  if (!parts.length) parts.push("Поток в пределах обычного.");
  return parts.join(" ");
}

function heat(node, X, B, stations) {
  const hrs = d3.range(6, 24);
  const W = width(node, 300), narrow = W < 640;
  const M = { t: 8, r: 8, b: 26, l: narrow ? 96 : 150 };
  const ch = 20, H = M.t + M.b + ch * 19;
  const x = d3.scaleBand().domain(hrs).range([M.l, W - M.r]).padding(0.06);
  const y = i => M.t + (18 - i) * ch;
  const col = v => d3.interpolateRgb(v < 0 ? "#2F5DA8" : "#D6083B", "#ECE9E2")(1 - Math.min(1, Math.abs(v) / 0.6));
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H);
  svg.selectAll("text.st").data(stations).join("text").attr("class", "st").attr("x", M.l - 8).attr("y", (d, i) => y(i) + ch / 2 + 4).attr("text-anchor", "end")
    .style("font-size", narrow ? "10.5px" : "12px").text(d => d);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`).call(d3.axisBottom(x).tickValues(narrow ? hrs.filter(h => h % 3 === 0) : hrs).tickSize(0).tickFormat(h => `${h}`));
  const cells = [];
  hrs.forEach(h => stations.forEach((s, i) => cells.push({ h, i, x: X[h][i], b: B[h][i], r: (X[h][i] + 30) / (B[h][i] + 30) - 1 })));
  svg.selectAll("rect").data(cells).join("rect").attr("x", d => x(d.h)).attr("y", d => y(d.i) + 1).attr("width", x.bandwidth()).attr("height", ch - 2).attr("rx", 2)
    .attr("fill", d => d.b < 50 ? "var(--rule-2)" : col(d.r))
    .on("mousemove", (ev, d) => tipShow(ev, `<b>${stations[d.i]}, ${d.h}:00–${d.h + 1}:00</b><br>вошло ${fmt(d.x)}, обычно ${fmt(d.b)}<br><b>${sgnPct(d.r)}</b>`))
    .on("mouseleave", tipHide);
}
