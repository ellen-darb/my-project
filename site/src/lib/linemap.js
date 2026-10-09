import * as d3 from "d3";
import { fmt, sgnPct, tipShow, tipHide, width } from "./util.js";

/* Схема линии 1 сверху вниз, как на указателях в метро: Девяткино наверху, Пр. Ветеранов внизу.
   Толщина и цвет линии на перегоне — сколько человек в составе, который едет к центру.
   Справа от станции — сколько людей вошло за последний час и насколько это больше или меньше обычного. */

const TRANSFER = new Set(["Пл. Восстания", "Владимирская", "Пушкинская", "Технологический ин-т"]);

export function drawLineMap(node, { meta, seg, ent, valid = true }) {
  const W = width(node, 300), narrow = W < 560;
  const st = meta.stations, n = st.length, norm = meta.c.norm;
  const rowH = narrow ? 30 : 32, top = 18, H = top * 2 + rowH * (n - 1);
  const xNum = narrow ? 40 : 64, xLine = narrow ? 58 : 92, xName = xLine + 22;
  const xBar = narrow ? xName + 118 : xName + 170, barW = Math.max(60, W - xBar - (narrow ? 44 : 70));
  const y = i => top + (n - 1 - i) * rowH;           // i = 0 — Пр. Ветеранов (низ)
  const bx = d3.scaleLinear().domain([0, Math.max(2500, d3.max(ent, e => Math.max(e.x, e.b)))]).range([0, barW]);

  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H).attr("class", "linemap")
    .attr("role", "img").attr("aria-label", "Схема линии 1: загрузка составов к центру и вход по станциям");

  svg.append("text").attr("class", "lm-colh").attr("x", xNum).attr("y", 10).attr("text-anchor", "end").text("человек");
  // зоны: север и юг — к центру, центр — пересадки
  const zone = (a, b, label, sub, fill) => {
    const g = svg.append("g");
    g.append("rect").attr("x", 0).attr("width", W).attr("y", y(b) - rowH / 2).attr("height", y(a) - y(b) + rowH).attr("fill", fill).attr("rx", 10);
    const yc = (y(a) + y(b)) / 2;
    if (!narrow) g.append("text").attr("class", "lm-zone").attr("transform", `translate(14,${yc}) rotate(-90)`).attr("text-anchor", "middle").text(label);
    return g;
  };
  zone(11, 18, "север ↓ к центру", "", "var(--band)");
  zone(0, 4, "юг ↑ к центру", "", "var(--band)");
  zone(5, 10, "центр: нет данных", "", "transparent");

  // линия: центр — тонкая и серая (загрузку по турникетам не оценить), сектора — по загрузке
  const segs = svg.append("g");
  seg.forEach((L, k) => {
    const y1 = y(k), y2 = y(k + 1);
    if (L == null) {
      segs.append("line").attr("x1", xLine).attr("x2", xLine).attr("y1", y1).attr("y2", y2)
        .attr("stroke", "var(--unknown)").attr("stroke-width", 6).attr("stroke-linecap", "round");
      return;
    }
    const w = 5 + Math.min(1, L / 1458) * 28;
    segs.append("line").attr("x1", xLine).attr("x2", xLine).attr("y1", y1).attr("y2", y2)
      .attr("stroke", mapColor(L, norm)).attr("stroke-width", w).attr("stroke-linecap", "butt")
      .on("mousemove", ev => tipShow(ev, `<b>${st[k + 1]} — ${st[k]}</b><br>в составе к центру: <b>${fmt(L)}</b> чел.<br>${L > norm ? `выше нормы на ${fmt(L - norm)}` : `${Math.round(L / norm * 100)}% нормы`}`))
      .on("mouseleave", tipHide);
    const ym = (y1 + y2) / 2;
    // число на перегоне
    svg.append("text").attr("class", "lm-num" + (L > norm ? " hot" : "")).attr("x", xNum).attr("y", ym + 4).attr("text-anchor", "end").text(fmt(L));
  });

  // станции
  const sg = svg.append("g").selectAll("g").data(st).join("g").attr("transform", (d, i) => `translate(0,${y(i)})`);
  sg.append("circle").attr("cx", xLine).attr("r", d => TRANSFER.has(d) ? 7 : 5.5)
    .attr("fill", "var(--sheet)").attr("stroke", "var(--ink)").attr("stroke-width", d => TRANSFER.has(d) ? 2.6 : 2);
  sg.append("text").attr("class", (d, i) => "lm-st" + (i === 11 || i === 4 ? " key" : "")).attr("x", xName).attr("y", 4.5)
    .text(d => narrow ? short(d) : d);

  // вход за час: серый — обычно, цвет — сейчас
  sg.append("rect").attr("x", xBar).attr("y", -5).attr("height", 10).attr("rx", 3).attr("width", (d, i) => Math.max(2, bx(ent[i].x)))
    .attr("fill", (d, i) => devColor(ent[i].x / Math.max(30, ent[i].b) - 1));
  sg.append("line").attr("x1", (d, i) => xBar + bx(ent[i].b)).attr("x2", (d, i) => xBar + bx(ent[i].b)).attr("y1", -9).attr("y2", 9)
    .attr("stroke", "var(--ink)").attr("stroke-width", 2);
  sg.append("text").attr("class", (d, i) => "lm-dev" + (ent[i].b >= 50 && ent[i].x / ent[i].b > 1.08 ? " up" : ent[i].b >= 50 && ent[i].x / ent[i].b < 0.92 ? " dn" : "")).attr("x", W - 2).attr("y", 4.5).attr("text-anchor", "end")
    .text((d, i) => { if (ent[i].b < 50) return ""; const v = Math.round((ent[i].x / ent[i].b - 1) * 100); return v === 0 ? "0%" : (v > 0 ? "+" : "−") + Math.abs(v) + "%"; });
  sg.append("rect").attr("x", 0).attr("y", -rowH / 2).attr("width", W).attr("height", rowH).attr("fill", "transparent")
    .on("mousemove", (ev, d) => { const i = st.indexOf(d); tipShow(ev, `<b>${d}</b><br>вошло за час: <b>${fmt(ent[i].x)}</b><br>обычно: ${fmt(ent[i].b)}`); })
    .on("mouseleave", tipHide);
  svg.node().appendChild(segs.node());   // линия поверх подложек строк, но под кружками
  svg.node().appendChild(sg.node().parentNode);
}

const lowRamp = d3.piecewise(d3.interpolateRgb, ["#ECE6DF", "#F3C6B8", "#EE8E8E", "#E04A63"]);
export const mapColor = (L, norm = 960) => L <= norm
  ? lowRamp(Math.max(0, L) / norm)
  : d3.interpolateRgb("#C8063A", "#5E001C")(Math.min(1, (L - norm) / (1458 - norm)));
const devColor = r => r > 0.08 ? "var(--amber)" : r < -0.08 ? "var(--blue)" : "var(--unknown)";
const SHORT = { "Технологический ин-т": "Технол. ин-т", "Гражданский пр.": "Гражданский", "Политехническая": "Политехнич.", "Кировский завод": "Кировский з-д", "Академическая": "Академич.", "Пл. Восстания": "Пл. Восстания", "Чернышевская": "Чернышевская", "Владимирская": "Владимирская", "Пр. Ветеранов": "Пр. Ветеранов" };
const short = s => SHORT[s] || s;
