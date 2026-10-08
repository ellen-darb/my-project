import * as d3 from "d3";
import { hhmm, fmt, tipShow, tipHide, width, dec } from "./util.js";

const X0 = 22, X1 = 96;   // 05:30 — 24:00

/* Загрузка состава на критическом перегоне за день: обычный день, факт, прогноз с интервалом, норма. */
export function sectorChart(node, { title, typ, fact, sys, fc, band, t, norm, maxTrain, height = 230, compact = false }) {
  const W = width(node, 280), H = height;
  const M = { t: 12, r: 12, b: 26, l: 44 };
  const x = d3.scaleLinear().domain([X0 * 15, X1 * 15]).range([M.l, W - M.r]);
  const ymax = Math.max(1500, d3.max(fact) || 0, d3.max(fc || [0]) || 0);
  const y = d3.scaleLinear().domain([0, ymax]).range([H - M.b, M.t]).nice();
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H)
    .attr("role", "img").attr("aria-label", title);
  const mid = s => s * 15 + 7.5;

  svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line")
    .attr("x1", M.l).attr("x2", W - M.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(0).tickFormat(d => fmt(d)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`)
    .call(d3.axisBottom(x).tickValues(d3.range(6 * 60, 24 * 60 + 1, compact ? 360 : 180)).tickSize(0).tickFormat(d => hhmm(d)));

  // выше нормы — подложка
  svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y(ymax)).attr("height", y(norm) - y(ymax))
    .attr("fill", "var(--red)").attr("opacity", 0.05);
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(norm)).attr("y2", y(norm))
    .attr("stroke", "var(--red)").attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
  svg.append("text").attr("x", W - M.r).attr("y", y(norm) - 5).attr("text-anchor", "end")
    .style("fill", "var(--red-ink)").style("font-weight", 600).text(`норма ${fmt(norm)}`);

  const line = d3.line().defined(d => d[1] != null).x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX);
  const rng = d3.range(X0, X1);
  svg.append("path").attr("d", line(rng.map(s => [mid(s), typ[s]]))).attr("fill", "none")
    .attr("stroke", "var(--ink-3)").attr("stroke-width", 1.5).attr("stroke-dasharray", "2 3");
  const upto = t == null ? X1 - 1 : t;
  if (sys) svg.append("path").attr("d", line(rng.filter(s => s <= upto).map(s => [mid(s), sys[s]]))).attr("fill", "none")
    .attr("stroke", "var(--blue)").attr("stroke-width", 2);
  svg.append("path").attr("d", line(rng.filter(s => s <= upto).map(s => [mid(s), fact[s]]))).attr("fill", "none")
    .attr("stroke", "var(--ink)").attr("stroke-width", 2);

  if (fc && t != null) {
    const pts = fc.map((v, h) => [mid(t + 1 + h), v, band ? v * band[h][0] : v, band ? v * band[h][1] : v]);
    pts.unshift([mid(t), fact[t], fact[t], fact[t]]);
    svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(d => y(d[2])).y1(d => y(d[3])).curve(d3.curveMonotoneX)(pts))
      .attr("fill", "var(--ink)").attr("opacity", 0.1);
    svg.append("path").attr("d", line(pts.map(d => [d[0], d[1]]))).attr("fill", "none")
      .attr("stroke", "var(--ink)").attr("stroke-width", 2).attr("stroke-dasharray", "5 3");
    svg.append("line").attr("x1", x((t + 1) * 15)).attr("x2", x((t + 1) * 15)).attr("y1", M.t).attr("y2", H - M.b)
      .attr("stroke", "var(--ink)").attr("opacity", 0.35);
  }

  // наведение
  const g = svg.append("g").style("display", "none");
  g.append("line").attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--ink-3)");
  const dot = g.append("circle").attr("r", 4).attr("fill", "var(--ink)").attr("stroke", "var(--paper)").attr("stroke-width", 2);
  svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b)
    .attr("fill", "transparent")
    .on("mousemove", ev => {
      const s = Math.max(X0, Math.min(X1 - 1, Math.floor(x.invert(d3.pointer(ev)[0]) / 15)));
      g.style("display", null).select("line").attr("x1", x(mid(s))).attr("x2", x(mid(s)));
      const isFc = t != null && s > t && s <= t + 8 && fc;
      const v = isFc ? fc[s - t - 1] : (t == null || s <= t ? fact[s] : null);
      dot.attr("cx", x(mid(s))).attr("cy", y(v ?? typ[s]));
      let html = `<b>${hhmm(s * 15)}–${hhmm(s * 15 + 15)}</b><br>`;
      if (v != null) html += `${isFc ? "прогноз" : "факт"}: <b>${fmt(v)}</b> чел. в составе<br>`;
      if (isFc && band) html += `<span class="muted">80% интервал: ${fmt(v * band[s - t - 1][0])}–${fmt(v * band[s - t - 1][1])}</span><br>`;
      if (sys && (t == null || s <= t)) html += `с мерами Такта: ${fmt(sys[s])}<br>`;
      html += `<span class="muted">обычный день: ${fmt(typ[s])}</span>`;
      tipShow(ev, html);
    })
    .on("mouseleave", () => { g.style("display", "none"); tipHide(); });
}

/* Парность: лист графика и с мерами системы. Предел 31,9 пары/ч (интервал 1:53). */
export function pairsChart(node, { plan, sys, t, maxPairs, height = 230, compact = false }) {
  const W = width(node, 280), H = height;
  const M = { t: 12, r: 12, b: 26, l: 36 };
  const x = d3.scaleLinear().domain([X0 * 15, X1 * 15]).range([M.l, W - M.r]);
  const y = d3.scaleLinear().domain([0, 34]).range([H - M.b, M.t]);
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H)
    .attr("role", "img").attr("aria-label", "Парность по графику и с мерами");
  svg.append("g").attr("class", "grid").selectAll("line").data([10, 20, 30]).join("line")
    .attr("x1", M.l).attr("x2", W - M.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`).call(d3.axisLeft(y).tickValues([0, 10, 20, 30]).tickSize(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`)
    .call(d3.axisBottom(x).tickValues(d3.range(6 * 60, 24 * 60 + 1, compact ? 360 : 180)).tickSize(0).tickFormat(d => hhmm(d)));
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(maxPairs)).attr("y2", y(maxPairs))
    .attr("stroke", "var(--red)").attr("stroke-dasharray", "6 4").attr("stroke-width", 1.5);
  svg.append("text").attr("x", M.l + 4).attr("y", y(maxPairs) - 5).style("fill", "var(--red-ink)").style("font-weight", 600)
    .text(`предел ${dec(maxPairs)} (интервал 1:53)`);
  const step = d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveStepAfter);
  const pts = arr => d3.range(X0, X1 + 1).map(s => [s * 15, arr[Math.min(s, 95)]]);
  // добавленное — заливка между планом и системой
  const area = d3.area().x(d => x(d[0])).y0(d => y(d[1])).y1(d => y(d[2])).curve(d3.curveStepAfter);
  const both = d3.range(X0, X1 + 1).map(s => [s * 15, plan[Math.min(s, 95)], sys[Math.min(s, 95)]]);
  svg.append("path").attr("d", area(both)).attr("fill", "var(--blue)").attr("opacity", 0.25);
  svg.append("path").attr("d", step(pts(plan))).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2);
  svg.append("path").attr("d", step(pts(sys))).attr("fill", "none").attr("stroke", "var(--blue)").attr("stroke-width", 2).attr("stroke-dasharray", "5 3");
  if (t != null) svg.append("line").attr("x1", x((t + 1) * 15)).attr("x2", x((t + 1) * 15)).attr("y1", M.t).attr("y2", H - M.b)
    .attr("stroke", "var(--ink)").attr("opacity", 0.35);
  svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b).attr("fill", "transparent")
    .on("mousemove", ev => {
      const s = Math.max(X0, Math.min(95, Math.floor(x.invert(d3.pointer(ev)[0]) / 15)));
      const tr = p => Math.round(p * 99 / 60);
      tipShow(ev, `<b>${hhmm(s * 15)}</b><br>по графику: ${dec(plan[s], 0)} пар/ч (≈${tr(plan[s])} сост.)<br>с мерами: <b>${dec(sys[s], 0)}</b> пар/ч (≈${tr(sys[s])} сост.)`);
    }).on("mouseleave", tipHide);
}
