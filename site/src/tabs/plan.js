import * as d3 from "d3";
import { load, fmt, hhmm, dec, tipShow, tipHide, width, pct } from "../lib/util.js";

const SCHED = [["weekday_sep", "Будни с 01.09"], ["weekday_summer", "Будни летом"], ["weekend", "Выходные"]];
const SECT = [["north", "Север → центр"], ["south", "Юг → центр"]];
let st = { s: "weekday_sep", sec: "north" };

export async function render(app) {
  const [meta, fit] = await Promise.all([load("meta.json"), load("schedule_fit.json")]);
  const pr = fit.weekday_sep.proposal;
  const f = fit.weekday_sep;
  const k9 = 36;
  app.innerHTML = `
  <div class="lede"><div>
    <p class="kicker">Для службы, которая составляет график</p>
    <h1>Утром составов с севера не хватает каждый будний день. Так устроен сам график.</h1>
    <p class="sub">С 07:45 до 09:30 в составе к центру с севера в среднем больше 960 человек. Добавить составы в 08:00 нельзя: на линии уже 53 из 53 при интервале 1:53. Но в 09:00 график снимает 6 пар, а поток к этому времени ещё ${fmt(f.north.p50[k9])} человек на состав.</p>
  </div></div>

  <div class="section">
    <div class="chart-title">
      <h3>Человек в составе на критическом перегоне, каждые 15 минут</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="seg" id="pl-s">${SCHED.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join("")}</div>
        <div class="seg" id="pl-sec">${SECT.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join("")}</div>
      </div>
    </div>
    <div class="legend" style="margin-bottom:8px">
      <span><i style="background:var(--ink)"></i>медиана дней</span>
      <span><i style="background:var(--band);height:10px"></i>8 из 10 дней</span>
      <span><i style="background:var(--red);height:2px"></i>максимум за все дни</span>
      <span><i class="dash" style="color:var(--red)"></i>норма 960</span>
      <span id="pl-n" class="note"></span>
    </div>
    <div id="pl-load"></div>
    
    <div class="chart-title" style="margin-top:14px"><h3>Парность по листу графика</h3>
      <span class="legend"><span><i style="background:var(--ink)"></i>лист графика</span><span id="pl-need-l"><i style="background:var(--blue)"></i>предложение Такта</span></span></div>
    <div id="pl-pairs"></div>
  </div>

  <div class="section">
    <div class="sec-head">
      <div><h2>Предлагаем: снимать составы после 09:30, а не в 09:00</h2></div>
      <p>Составы для этого уже на линии, их просто дольше не уводят в депо. Парность подобрана так, чтобы обычный будний день укладывался в норму.</p>
    </div>
    <div class="big-row">
      <div class="big"><div class="v">−${Math.round((1 - pr.over_new_day / pr.over_plan_day) * 100)}<small>%</small></div><div class="k">пассажиров сверх нормы в будний день</div></div>
      <div class="big"><div class="v">${fmt(pr.wait_saved_h_day)}</div><div class="k">часов ожидания меньше в день на всех пассажиров</div></div>
      <div class="big"><div class="v">+${dec(pr.extra_train_h_day)}</div><div class="k">поездо-часа в день</div></div>
    </div>
    <h3 style="margin-top:28px">Что поменять в листе графика «рабочий с 01.09»</h3>
    <table class="t" id="pl-tab"></table>
  </div>`;

  // таблица изменений
  const changes = d3.range(96).filter(k => f.need[k] !== f.pairs[k]);
  document.getElementById("pl-tab").innerHTML = `<thead><tr><th>Интервал</th><th class="r">Сейчас, пар/ч</th><th class="r">Предлагаем</th><th class="r">Составов</th><th class="r">Человек в составе с севера сейчас</th><th class="r">При предложении</th></tr></thead><tbody>${changes.map(k => `<tr><td>${hhmm(k * 15)}–${hhmm(k * 15 + 15)}</td><td class="r">${f.pairs[k]}</td><td class="r"><b>${f.need[k]}</b></td><td class="r">+${Math.round(f.need[k] * 99 / 60) - Math.round(f.pairs[k] * 99 / 60)}</td><td class="r">${fmt(f.north.p50[k])}</td><td class="r">${fmt(f.north.p50[k] * f.pairs[k] / f.need[k])}</td></tr>`).join("")}</tbody>`;

  const draw = () => {
    document.querySelectorAll("#pl-s button").forEach(b => b.classList.toggle("on", b.dataset.k === st.s));
    document.querySelectorAll("#pl-sec button").forEach(b => b.classList.toggle("on", b.dataset.k === st.sec));
    const F = fit[st.s];
    document.getElementById("pl-n").textContent = `· ${F.n} дней${st.s === "weekday_sep" ? " сентября" : ""}`;
    loadChart(document.getElementById("pl-load"), F[st.sec], meta);
    pairsRow(document.getElementById("pl-pairs"), F.pairs, st.s === "weekday_sep" ? F.need : null, meta);
    document.getElementById("pl-need-l").style.display = st.s === "weekday_sep" ? "" : "none";
  };
  document.querySelectorAll("#pl-s button").forEach(b => b.onclick = () => { st.s = b.dataset.k; draw(); });
  document.querySelectorAll("#pl-sec button").forEach(b => b.onclick = () => { st.sec = b.dataset.k; draw(); });
  draw();
}

const X0 = 22, X1 = 96;
function frame(node, H, M) {
  const W = width(node, 300);
  const x = d3.scaleLinear().domain([X0 * 15, X1 * 15]).range([M.l, W - M.r]);
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`)
    .call(d3.axisBottom(x).tickValues(d3.range(6 * 60, 24 * 60 + 1, W < 640 ? 360 : 60)).tickSize(0).tickFormat(d => hhmm(d)));
  return { svg, x, W };
}

function loadChart(node, S, meta) {
  const H = 340, M = { t: 16, r: 24, b: 26, l: 48 };
  const { svg, x, W } = frame(node, H, M);
  const y = d3.scaleLinear().domain([0, 1600]).range([H - M.b, M.t]);
  const mid = k => k * 15 + 7.5;
  svg.append("g").attr("class", "grid").selectAll("line").data([400, 800, 1200, 1600]).join("line")
    .attr("x1", M.l).attr("x2", W - M.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`).call(d3.axisLeft(y).tickValues([0, 400, 800, 1200, 1600]).tickSize(0).tickFormat(fmt));
  const ks = d3.range(X0, X1);
  // зоны выше нормы по медиане
  ks.filter(k => S.p50[k] > meta.c.norm).forEach(k => svg.append("rect").attr("x", x(k * 15)).attr("width", x(15) - x(0))
    .attr("y", M.t).attr("height", H - M.b - M.t).attr("fill", "var(--red)").attr("opacity", 0.07));
  svg.append("path").attr("d", d3.area().x(k => x(mid(k))).y0(k => y(S.p10[k])).y1(k => y(S.p90[k])).curve(d3.curveMonotoneX)(ks))
    .attr("fill", "var(--band)");
  svg.append("path").attr("d", d3.line().x(k => x(mid(k))).y(k => y(S.max[k])).curve(d3.curveMonotoneX)(ks))
    .attr("fill", "none").attr("stroke", "var(--red)").attr("stroke-width", 1).attr("opacity", 0.7);
  svg.append("path").attr("d", d3.line().x(k => x(mid(k))).y(k => y(S.p50[k])).curve(d3.curveMonotoneX)(ks))
    .attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2.2);
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(meta.c.norm)).attr("y2", y(meta.c.norm))
    .attr("stroke", "var(--red)").attr("stroke-dasharray", "6 4").attr("stroke-width", 1.5);
  svg.append("text").attr("x", W - M.r).attr("y", y(meta.c.norm) - 6).attr("text-anchor", "end").style("fill", "var(--red-ink)").style("font-weight", 600).text("норма 960");
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(meta.c.max_train)).attr("y2", y(meta.c.max_train))
    .attr("stroke", "var(--ink-3)").attr("stroke-dasharray", "2 3");
  svg.append("text").attr("x", W - M.r).attr("y", y(meta.c.max_train) - 6).attr("text-anchor", "end").style("fill", "var(--ink-3)").text("предел 1 458 (5 чел./м²)");
  const g = svg.append("g").style("display", "none");
  g.append("line").attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--ink-3)");
  svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b).attr("fill", "transparent")
    .on("mousemove", ev => {
      const k = Math.max(X0, Math.min(X1 - 1, Math.floor(x.invert(d3.pointer(ev)[0]) / 15)));
      g.style("display", null).select("line").attr("x1", x(mid(k))).attr("x2", x(mid(k)));
      tipShow(ev, `<b>${hhmm(k * 15)}–${hhmm(k * 15 + 15)}</b><br>медиана: <b>${fmt(S.p50[k])}</b> чел. в составе (${pct(S.p50[k] / meta.c.norm)} нормы)<br><span class="muted">8 из 10 дней: ${fmt(S.p10[k])}–${fmt(S.p90[k])}<br>максимум: ${fmt(S.max[k])}</span>`);
    }).on("mouseleave", () => { g.style("display", "none"); tipHide(); });
}

function pairsRow(node, plan, need, meta) {
  const H = 150, M = { t: 14, r: 24, b: 26, l: 48 };
  const { svg, x, W } = frame(node, H, M);
  const y = d3.scaleLinear().domain([0, 34]).range([H - M.b, M.t]);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`).call(d3.axisLeft(y).tickValues([0, 10, 20, 30]).tickSize(0));
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(meta.c.max_pairs)).attr("y2", y(meta.c.max_pairs)).attr("stroke", "var(--red)").attr("stroke-dasharray", "6 4");
  const pts = a => d3.range(X0, X1 + 1).map(k => [k * 15, a[Math.min(k, 95)]]);
  const step = d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveStepAfter);
  if (need) {
    svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(d => y(d[1])).y1(d => y(d[2])).curve(d3.curveStepAfter)(
      d3.range(X0, X1 + 1).map(k => [k * 15, plan[Math.min(k, 95)], need[Math.min(k, 95)]]))).attr("fill", "var(--blue)").attr("opacity", 0.3);
    svg.append("path").attr("d", step(pts(need))).attr("fill", "none").attr("stroke", "var(--blue)").attr("stroke-width", 2);
  }
  svg.append("path").attr("d", step(pts(plan))).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2);
  svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b).attr("fill", "transparent")
    .on("mousemove", ev => {
      const k = Math.max(X0, Math.min(95, Math.floor(x.invert(d3.pointer(ev)[0]) / 15)));
      tipShow(ev, `<b>${hhmm(k * 15)}</b><br>лист: ${plan[k]} пар/ч${need ? `<br>предложение: <b>${need[k]}</b>` : ""}`);
    }).on("mouseleave", tipHide);
}
