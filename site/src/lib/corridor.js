import * as d3 from "d3";
import { hhmm, fmt, tipShow, tipHide, width } from "./util.js";

/* Коридор на 2 часа: самая полная загрузка состава к центру в каждом 15-минутном слоте.
   Те же числа, что в совете и в полосе состояния: их даёт один расчёт (lib/engine.js).
   plan — по листу графика, sys — если выполнить совет, полоса — 80% интервал прогноза потока. */
export const HORIZON = 120, STEP = 15;

export function computeCorridor({ t, loadPlan, loadSys, morningEnd, q }) {
  return d3.range(0, 8).map(h => {
    const s = t + 1 + h;
    if (s >= 96) return { off: h * STEP, s, valid: false };
    const valid = s < morningEnd;
    const r = q[String((h + 1) * 15)];
    return { off: h * STEP, s, valid, plan: loadPlan[s], sys: loadSys[s], lo: loadPlan[s] * r[1], hi: loadPlan[s] * r[3] };
  });
}

export function drawCorridor(node, { pts, off, norm, nowMin, onPick }) {
  const W = width(node, 280), H = 176, M = { t: 14, r: 12, b: 28, l: 44 };
  const x = d3.scaleLinear().domain([0, HORIZON]).range([M.l, W - M.r]);
  const ok = pts.filter(p => p.valid);
  const ymax = Math.max(1100, (d3.max(ok, p => Math.max(p.hi, p.plan, p.sys)) || 0) * 1.06);
  const y = d3.scaleLinear().domain([0, ymax]).range([H - M.b, M.t]).nice();
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H)
    .attr("role", "img").attr("aria-label", "Загрузка самого полного состава на ближайшие 2 часа");
  svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(3)).join("line")
    .attr("x1", M.l).attr("x2", W - M.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`).call(d3.axisLeft(y).ticks(3).tickSize(0).tickFormat(d => fmt(d)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`)
    .call(d3.axisBottom(x).tickValues(d3.range(0, 121, 30)).tickSize(0).tickFormat(o => hhmm(nowMin + o)))
    .selectAll("text").attr("text-anchor", (o, i, n) => (i === n.length - 1 ? "end" : i === 0 ? "start" : "middle"));

  svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y.range()[1]).attr("height", Math.max(0, y(norm) - y.range()[1]))
    .attr("fill", "var(--red)").attr("opacity", 0.06);
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(norm)).attr("y2", y(norm)).attr("stroke", "var(--red)").attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
  svg.append("text").attr("x", M.l + 6).attr("y", y(norm) - 5).style("fill", "var(--red-ink)").style("font-weight", 600).text(`норма ${fmt(norm)}`);

  // после 11:00 загрузку по входам не оцениваем: нет данных о выходах
  const bad = pts.filter(p => !p.valid);
  if (bad.length) {
    const x0 = x(bad[0].off);
    svg.append("rect").attr("x", x0).attr("width", W - M.r - x0).attr("y", M.t).attr("height", H - M.t - M.b).attr("fill", "url(#cor-hatch)");
    svg.append("defs").append("pattern").attr("id", "cor-hatch").attr("width", 7).attr("height", 7).attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
      .append("line").attr("y2", 7).attr("stroke", "var(--rule)").attr("stroke-width", 2);
    svg.append("text").attr("x", (x0 + W - M.r) / 2).attr("y", (M.t + H - M.b) / 2).attr("text-anchor", "middle").attr("class", "cor-na")
      .text(ok.length ? "после 11:00 по входам не оцениваем" : "вне утреннего пика по входам не оцениваем");
  }
  const steps = key => ok.flatMap(p => [[p.off, p[key]], [p.off + STEP, p[key]]]);
  const line = d3.line().x(d => x(d[0])).y(d => y(d[1]));
  if (ok.length) {
    svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(d => y(d[1])).y1(d => y(d[2]))(ok.flatMap(p => [[p.off, p.lo, p.hi], [p.off + STEP, p.lo, p.hi]])))
      .attr("fill", "var(--ink)").attr("opacity", 0.1);
    svg.append("path").attr("d", line(steps("plan"))).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2.2);
    if (ok.some(p => Math.abs(p.sys - p.plan) > 8))
      svg.append("path").attr("d", line(steps("sys"))).attr("fill", "none").attr("stroke", "var(--blue)").attr("stroke-width", 2.4).attr("stroke-dasharray", "6 3");
  }
  const cur = pts.find(p => p.off === off) || pts[0];
  svg.append("rect").attr("x", x(cur.off)).attr("width", x(STEP) - x(0)).attr("y", M.t).attr("height", H - M.t - M.b).attr("fill", "var(--ink)").attr("opacity", 0.07);
  svg.append("line").attr("x1", x(off)).attr("x2", x(off)).attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
  svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b).attr("fill", "transparent").style("cursor", "pointer")
    .on("mousemove", ev => {
      const p = at(ev);
      tipShow(ev, p.valid ? `<b>${hhmm(nowMin + p.off)}–${hhmm(nowMin + p.off + STEP)}</b>${p.off ? ` · через ${p.off} мин` : ""}<br>самый полный состав: <b>${fmt(p.plan)}</b> чел.${p.off ? `<br><span class="muted">80% интервал: ${fmt(p.lo)}–${fmt(p.hi)}</span>` : ""}`
        : `<b>${hhmm(nowMin + p.off)}</b><br><span class="muted">по входам не оцениваем: нет данных о выходах</span>`);
    })
    .on("mouseleave", tipHide)
    .on("click", ev => onPick(at(ev).off));
  function at(ev) {
    const o = Math.max(0, Math.min(HORIZON - STEP, Math.floor(x.invert(d3.pointer(ev)[0]) / STEP) * STEP));
    return pts.find(z => z.off === o);
  }
}
