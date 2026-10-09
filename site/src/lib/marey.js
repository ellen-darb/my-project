import * as d3 from "d3";
import { loadColor, hhmm, fmt, tipShow, tipHide, css, width } from "./util.js";

/* График движения (диаграмма Марея): время по горизонтали, станции по вертикали.
   Нитки строятся по парности листа графика оборота (схема, не фактические нитки).
   Цвет нитки на перегоне — расчётная загрузка состава к центру: α × входы выше по ходу / составов за 15 мин.
   В центре (пересадки) и на выезде из центра загрузку по турникетам оценить нельзя — нитка серая и тонкая. */

const SEG_MIN = 46 / 18;

export function trains(pairs) {
  const out = [];
  for (const dir of ["S", "N"]) {
    let tau = 22 * 15 + (dir === "S" ? 0 : SEG_MIN * 0.5);
    while (tau < 24 * 60) {
      const p = pairs[Math.floor(tau / 15)] || 0;
      if (p <= 0) { tau = (Math.floor(tau / 15) + 1) * 15; continue; }
      out.push({ dir, dep: tau });
      tau += 60 / p;
    }
  }
  return out;
}

/* время прохода станции i: S — от Девяткино (18) вниз, N — от Ветеранов (0) вверх */
const at = (tr, i) => tr.dir === "S" ? tr.dep + (18 - i) * SEG_MIN : tr.dep + i * SEG_MIN;

export function drawMarey(node, { meta, nowMin, pairs, loadAt, span = [-60, 120], height = 540 }) {
  const W = width(node, 320);
  const narrow = W < 640;
  const M = { t: 26, r: narrow ? 8 : 132, b: 30, l: narrow ? 84 : 150 };
  const SHORT = { "Технологический ин-т": "Технол. ин-т", "Гражданский пр.": "Гражданский", "Политехническая": "Политехнич.", "Кировский завод": "Кировский з-д", "Академическая": "Академич.", "Пл. Восстания": "Пл. Восст.", "Пр. Ветеранов": "Пр. Ветеранов", "Чернышевская": "Чернышевск.", "Владимирская": "Владимирск." };
  const H = height;
  const x = d3.scaleLinear().domain([nowMin + span[0], nowMin + span[1]]).range([M.l, W - M.r]);
  const st = meta.stations;
  const y = d3.scaleLinear().domain([0, 18]).range([H - M.b, M.t]);

  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H).attr("role", "img")
    .attr("aria-label", "График движения линии 1 с расчётной загрузкой составов");

  // сектора
  const sec = [
    { a: 11, b: 18, name: "Север", sub: "8 станций без пересадок" },
    { a: 0, b: 4, name: "Юг", sub: "5 станций без пересадок" },
    { a: 5, b: 10, name: "Центр", sub: "пересадки, выходы неизвестны" },
  ];
  svg.append("g").selectAll("rect").data(sec.slice(0, 2)).join("rect")
    .attr("x", M.l).attr("width", W - M.l - M.r)
    .attr("y", d => y(d.b) - 6).attr("height", d => y(d.a) - y(d.b) + 12)
    .attr("fill", "var(--band)");

  // прогнозная зона
  const xn = x(nowMin);
  svg.append("rect").attr("x", xn).attr("y", M.t - 14).attr("width", W - M.r - xn).attr("height", H - M.b - M.t + 20)
    .attr("fill", "var(--ink)").attr("opacity", 0.035);
  const defs = svg.append("defs");
  const pat = defs.append("pattern").attr("id", "hatch").attr("width", 6).attr("height", 6)
    .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)");
  pat.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "var(--rule-2)").attr("stroke-width", 2);

  // сетка времени
  const ticks = d3.range(Math.ceil((nowMin + span[0]) / 30) * 30, nowMin + span[1] + 1, 30);
  svg.append("g").selectAll("line").data(ticks).join("line")
    .attr("x1", d => x(d)).attr("x2", d => x(d)).attr("y1", M.t - 6).attr("y2", H - M.b + 4)
    .attr("stroke", d => d % 60 === 0 ? "var(--rule)" : "var(--rule-2)");
  svg.append("g").selectAll("text").data(ticks.filter(d => d % 60 === 0 || !narrow)).join("text")
    .attr("x", d => x(d)).attr("y", H - 10).attr("text-anchor", "middle").attr("class", "num")
    .text(d => hhmm(d));

  // станции
  const g = svg.append("g");
  g.selectAll("line").data(st).join("line")
    .attr("x1", M.l).attr("x2", W - M.r).attr("y1", (d, i) => y(i)).attr("y2", (d, i) => y(i))
    .attr("stroke", "var(--rule-2)");
  g.selectAll("text").data(st).join("text")
    .attr("x", M.l - 10).attr("y", (d, i) => y(i) + 4).attr("text-anchor", "end")
    .style("font-size", narrow ? "10.5px" : "12px")
    .style("font-weight", (d, i) => (i === 11 || i === 4) ? 700 : 400)
    .style("fill", (d, i) => (i >= 5 && i <= 10) ? "var(--ink-3)" : "var(--ink-2)")
    .text(d => narrow ? (SHORT[d] || d) : d);

  // критические перегоны
  for (const [a, b, label] of [[10, 11, "Пл. Ленина → Чернышевская"], [4, 5, "Нарвская → Балтийская"]]) {
    svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y((a + b) / 2)).attr("y2", y((a + b) / 2))
      .attr("stroke", "var(--ink)").attr("stroke-dasharray", "2 4").attr("opacity", 0.5);
  }
  if (!narrow) {
    const r = svg.append("g").attr("transform", `translate(${W - M.r + 14},0)`);
    for (const s of sec) {
      r.append("line").attr("x1", 0).attr("x2", 0).attr("y1", y(s.b) - 4).attr("y2", y(s.a) + 4)
        .attr("stroke", s.name === "Центр" ? "var(--rule)" : "var(--ink)").attr("stroke-width", 2);
      r.append("text").attr("x", 10).attr("y", (y(s.a) + y(s.b)) / 2 - 3).style("font-weight", 700)
        .style("fill", "var(--ink)").text(s.name);
      r.append("text").attr("x", 10).attr("y", (y(s.a) + y(s.b)) / 2 + 12).style("font-size", "11px")
        .style("fill", "var(--ink-3)").call(t => wrap(t, s.sub, 110));
    }
  }

  // нитки
  const lo = nowMin + span[0] - 50, hi = nowMin + span[1] + 2;
  const list = trains(pairs).filter(t => t.dep < hi && t.dep + 46 > lo);
  const segs = [];
  for (const tr of list) {
    for (let k = 0; k < 18; k++) {
      const [i0, i1] = tr.dir === "S" ? [k + 1, k] : [k, k + 1];
      const t0 = at(tr, i0), t1 = at(tr, i1);
      if (t1 < nowMin + span[0] || t0 > nowMin + span[1]) continue;
      const inbound = (tr.dir === "S" && k >= 10) || (tr.dir === "N" && k <= 4);
      segs.push({ tr, k, t0, t1, i0, i1, L: inbound ? loadAt(k, (t0 + t1) / 2) : null, fc: (t0 + t1) / 2 > nowMin });
    }
  }
  const clip = defs.append("clipPath").attr("id", "mclip");
  clip.append("rect").attr("x", M.l).attr("y", 0).attr("width", W - M.l - M.r).attr("height", H);
  const lines = svg.append("g").attr("clip-path", "url(#mclip)");
  segs.sort((a, b) => (a.L ?? -1) - (b.L ?? -1));
  lines.selectAll("line").data(segs).join("line")
    .attr("x1", d => x(d.t0)).attr("x2", d => x(d.t1)).attr("y1", d => y(d.i0)).attr("y2", d => y(d.i1))
    .attr("stroke", d => d.L == null ? "var(--unknown)" : loadColor(d.L, meta.c.norm))
    .attr("stroke-width", d => d.L == null ? 0.8 : (d.L > meta.c.norm ? 2.4 : 1.2))
    .attr("stroke-linecap", "round")
    .attr("opacity", d => d.L == null ? 0.45 : (d.L > meta.c.norm ? 1 : 0.75));

  // «сейчас»
  svg.append("line").attr("x1", xn).attr("x2", xn).attr("y1", M.t - 16).attr("y2", H - M.b + 4)
    .attr("stroke", "var(--ink)").attr("stroke-width", 2);
  svg.append("text").attr("x", xn + 6).attr("y", M.t - 8).style("font-weight", 700).style("fill", "var(--ink)")
    .text(`${hhmm(nowMin)} · дальше прогноз`);
  svg.append("text").attr("x", xn - 6).attr("y", M.t - 8).attr("text-anchor", "end").style("fill", "var(--ink-3)")
    .text("факт");

  // наведение: ближайшая нитка
  const hit = svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b)
    .attr("fill", "transparent");
  const mark = svg.append("circle").attr("r", 5).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2).style("display", "none");
  const known = segs.filter(s => s.L != null);
  hit.on("mousemove", ev => {
    const [mx, my] = d3.pointer(ev);
    let best = null, bd = 14;
    for (const s of known) {
      const x0 = x(s.t0), x1 = x(s.t1), y0 = y(s.i0), y1 = y(s.i1);
      const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((mx - x0) * dx + (my - y0) * dy) / l2));
      const dd = Math.hypot(mx - (x0 + u * dx), my - (y0 + u * dy));
      if (dd < bd) { bd = dd; best = { s, px: x0 + u * dx, py: y0 + u * dy }; }
    }
    if (!best) { mark.style("display", "none"); tipHide(); return; }
    const s = best.s;
    mark.style("display", null).attr("cx", best.px).attr("cy", best.py);
    const over = s.L > meta.c.norm;
    tipShow(ev, `<b>${st[s.i0]} → ${st[s.i1]}</b><br>${hhmm(s.t0)} · ${s.tr.dir === "S" ? "к центру с севера" : "к центру с юга"}<br>`
      + `≈ <b>${fmt(s.L)}</b> чел. в составе ${over ? `<span>· выше нормы на ${fmt(s.L - meta.c.norm)}</span>` : ""}`
      + `<br><span class="muted">${s.fc ? "прогноз" : "по факту турникетов"}, норма ${fmt(meta.c.norm)}</span>`);
  }).on("mouseleave", () => { mark.style("display", "none"); tipHide(); });
}

function wrap(textSel, str, w) {
  const words = str.split(" ");
  let line = [], tsp = textSel.append("tspan").attr("x", 10);
  let n = 0;
  for (const word of words) {
    line.push(word);
    tsp.text(line.join(" "));
    if (tsp.node().getComputedTextLength() > w && line.length > 1) {
      line.pop(); tsp.text(line.join(" "));
      line = [word]; n++;
      tsp = textSel.append("tspan").attr("x", 10).attr("dy", 13).text(word);
    }
  }
}
