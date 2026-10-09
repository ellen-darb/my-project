import * as d3 from "d3";
import { hhmm, fmt, tipShow, tipHide, width } from "./util.js";
import { criticalLoads, mapColor } from "./linemap.js";

/* Коридор на 2 часа: самая полная загрузка состава к центру на каждом шаге вперёд.
   plan — по листу графика, sys — если выполнить совет, полоса — 80% интервал прогноза потока (как в проверке на июле и сентябре). */
export const STEP = 5, HORIZON = 120;

export function computeCorridor({ tm0, entriesAt, planPairs, sysPairs, meta, q }) {
  const ratio = (off, k) => {            // k = 1 нижняя граница, 3 верхняя
    if (off <= 0) return 1;
    const h = off / 15, h0 = Math.floor(h), h1 = Math.ceil(h);
    const at = hh => (hh <= 0 ? 1 : q[String(Math.min(HORIZON, hh * 15))][k]);
    return h0 === h1 ? at(h0) : at(h0) + (at(h1) - at(h0)) * (h - h0);
  };
  return d3.range(0, HORIZON + 1, STEP).map(off => {
    const plan = criticalLoads(tm0 + off, entriesAt, planPairs, meta).max;
    const sys = criticalLoads(tm0 + off, entriesAt, sysPairs, meta).max;
    return { off, plan, sys, lo: plan * ratio(off, 1), hi: plan * ratio(off, 3) };
  });
}

/* через сколько минут станет тесно: центральная оценка и границы интервала */
export function overloadIn(pts, norm) {
  const first = f => { const p = pts.find(f); return p ? p.off : null; };
  return { mid: first(p => p.plan > norm), early: first(p => p.hi > norm), late: first(p => p.lo > norm) };
}

export function drawCorridor(node, { pts, off, norm, nowMin, onPick }) {
  const W = width(node, 280), H = 170, M = { t: 14, r: 14, b: 28, l: 44 };
  const x = d3.scaleLinear().domain([0, HORIZON]).range([M.l, W - M.r]);
  const ymax = Math.max(1100, d3.max(pts, p => Math.max(p.hi, p.plan, p.sys)) * 1.05);
  const y = d3.scaleLinear().domain([0, ymax]).range([H - M.b, M.t]).nice();
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H)
    .attr("role", "img").attr("aria-label", "Загрузка самого полного состава на ближайшие 2 часа");
  svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(3)).join("line")
    .attr("x1", M.l).attr("x2", W - M.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`).call(d3.axisLeft(y).ticks(3).tickSize(0).tickFormat(d => fmt(d)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`)
    .call(d3.axisBottom(x).tickValues(d3.range(0, 121, 30)).tickSize(0).tickFormat(o => hhmm(nowMin + o)))
    .selectAll("text").attr("text-anchor", (o, i, n) => (i === n.length - 1 ? "end" : i === 0 ? "start" : "middle"));
  // выше нормы
  svg.append("rect").attr("x", M.l).attr("width", W - M.l - M.r).attr("y", y.range()[1]).attr("height", Math.max(0, y(norm) - y.range()[1]))
    .attr("fill", "var(--red)").attr("opacity", 0.06);
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(norm)).attr("y2", y(norm)).attr("stroke", "var(--red)").attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
  svg.append("text").attr("x", M.l + 6).attr("y", y(norm) - 5).style("fill", "var(--red-ink)").style("font-weight", 600).text(`норма ${fmt(norm)}`);
  // полоса и линии
  svg.append("path").attr("d", d3.area().x(p => x(p.off)).y0(p => y(p.lo)).y1(p => y(p.hi)).curve(d3.curveMonotoneX)(pts)).attr("fill", "var(--ink)").attr("opacity", 0.1);
  svg.append("path").attr("d", d3.line().x(p => x(p.off)).y(p => y(p.plan)).curve(d3.curveMonotoneX)(pts)).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2.2);
  if (pts.some(p => Math.abs(p.sys - p.plan) > 8))
    svg.append("path").attr("d", d3.line().x(p => x(p.off)).y(p => y(p.sys)).curve(d3.curveMonotoneX)(pts)).attr("fill", "none").attr("stroke", "var(--blue)").attr("stroke-width", 2).attr("stroke-dasharray", "5 3");
  // выбранный момент
  const cur = pts.find(p => p.off === off) || pts[0];
  svg.append("line").attr("x1", x(off)).attr("x2", x(off)).attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
  svg.append("circle").attr("cx", x(off)).attr("cy", y(cur.plan)).attr("r", 5).attr("fill", mapColor(cur.plan, norm)).attr("stroke", "var(--ink)").attr("stroke-width", 2);
  svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b).attr("fill", "transparent").style("cursor", "pointer")
    .on("mousemove", ev => {
      const o = Math.max(0, Math.min(HORIZON, Math.round(x.invert(d3.pointer(ev)[0]) / STEP) * STEP));
      const p = pts.find(z => z.off === o);
      tipShow(ev, `<b>${hhmm(nowMin + o)}</b>${o ? ` · через ${o} мин` : ""}<br>самый полный состав: <b>${fmt(p.plan)}</b> чел.${o ? `<br><span class="muted">80% интервал: ${fmt(p.lo)}–${fmt(p.hi)}</span>` : ""}`);
    })
    .on("mouseleave", tipHide)
    .on("click", ev => onPick(Math.max(0, Math.min(HORIZON, Math.round(x.invert(d3.pointer(ev)[0]) / STEP) * STEP))));
}
