import * as d3 from "d3";
import { load, fmt, pct, dec, tipShow, tipHide, width, slotStr, dayLong } from "../lib/util.js";

const EX = [
  { d: "2026-09-15", t: 28, k: "15 сентября, вторник", note: "Обычный учебный день. Перегрузку утром с севера видно уже по «обычному дню»; прогноз почти не отличается от него, а в 08:00 ошибается даже сильнее (6,2% против 3,0%)." },
  { d: "2026-07-06", t: 32, k: "6 июля, понедельник", note: "Поток на 8% ниже обычного. К 08:00 Такт видит это по первому часу и опускает прогноз: ошибка 5,9% против 11,9% у «обычного дня»." },
  { d: "2026-09-12", t: 48, k: "12 сентября, суббота", note: "Поток на 15% выше обычного весь день. Прогноз держится ближе к факту: в 12:00 ошибка 4,5% против 13,7%. Но до нормы далеко, и составы не нужны." },
];

export async function render(app) {
  const f = await load("forecast.json");
  const at = (sec, h, k) => f.sector.find(r => r.sec === sec && r.h === h)[k];
  const det = f.detect.all, an = f.detect.anomalous;
  app.innerHTML = `
  <div class="lede"><div>
    <p class="kicker">Прогноз · проверка на июле и сентябре</p>
    <h1>На два часа вперёд ошибаемся на 4–5%. Без прогноза ошибка 5–6%.</h1>
    <p class="sub">Прогноз — это «обычный день», поправленный на то, как идёт поток в последний час. Веса поправки подобраны на ${f.train_days} днях февраля и мая, проверка — на ${f.test_days} днях июля и сентября, которых модель не видела. Каждая точка проверки знает только прошлое относительно момента прогноза.</p>
  </div></div>

  <div class="section">
    <div class="big-row">
      <div class="big"><div class="v">${pct(at("north", 30, "ratio"), 1)}</div><div class="k">ошибка через 30 мин, поток к центру с севера</div><div class="src">обычный день: ${pct(at("north", 30, "plan"), 1)}</div></div>
      <div class="big"><div class="v">${pct(at("north", 120, "ratio"), 1)}</div><div class="k">ошибка через 2 часа</div><div class="src">обычный день: ${pct(at("north", 120, "plan"), 1)}</div></div>
      <div class="big"><div class="v">${pct(det.ratio.recall, 0)}</div><div class="k">перегрузок замечено заранее, за 15–120 мин</div><div class="src">${det.ratio.tp} из ${det.ratio.tp + det.ratio.fn} окон</div></div>
      <div class="big"><div class="v">${pct(det.ratio.precision, 0)}</div><div class="k">предупреждений подтвердились</div><div class="src">ложных: ${det.ratio.fp} из ${det.ratio.tp + det.ratio.fp}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="sec-head">
      <div><p class="kicker">Пример дня</p><h2>Что Такт видел и что случилось на самом деле</h2></div>
      <p>Двигайте момент прогноза. Слева от него Такт знает факт, справа видит только свой прогноз на 2 часа и «обычный день». Серым — то, что произошло потом. Загрузка — пассажиров в составе на критическом перегоне при парности по графику.</p>
    </div>
    <div class="fx-ctl">
      <div class="presets" id="fx-days">${EX.map((e, i) => `<button class="btn${i ? "" : " on"}" data-i="${i}">${e.k}</button>`).join("")}</div>
      <div class="seg" id="fx-sec"><button class="on" data-s="north">Север</button><button data-s="south">Юг</button></div>
    </div>
    <p class="note" id="fx-note"></p>
    <div id="fx-chart"></div>
    <div class="fx-slide"><label for="fx-t">Момент прогноза <b id="fx-tl"></b></label><input type="range" id="fx-t" min="24" max="87" step="1"></div>
    <div class="fx-read" id="fx-read"></div>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--ink)"></i>факт до момента прогноза</span><span><i style="background:var(--blue)"></i>прогноз Такта</span><span><i class="dash" style="color:var(--ink-3)"></i>обычный день</span><span><i style="background:var(--ink-3);opacity:.7"></i>факт, которого Такт ещё не знал</span><span><i class="dash" style="color:var(--red)"></i>норма 960</span></div>
  </div>

  <div class="section">
    <div class="sec-head">
      <div><p class="kicker">Ошибка по горизонту</p><h2>Чем дальше, тем ближе прогноз к «обычному дню»</h2></div>
      <p>WAPE: сумма |факт − прогноз| / сумма факта, по 15-минутным интервалам 06:00–22:00. Поток к центру считается по входам станций сектора с учётом времени в пути, поэтому через 15 минут он почти весь уже вошёл в турникеты.</p>
    </div>
    <div class="cols-2">
      <div><div class="chart-title"><h3>Север → центр</h3></div><div id="fc-n"></div></div>
      <div><div class="chart-title"><h3>Юг → центр</h3></div><div id="fc-s"></div></div>
    </div>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--ink)"></i>прогноз Такта</span><span><i class="dash" style="color:var(--ink-3)"></i>обычный день (то, на что рассчитан график)</span><span><i style="background:var(--unknown)"></i>«как сейчас, так и дальше» — за пределами шкалы после 30 мин</span></div>
  </div>

  <div class="section">
        <h2>Честно о слабых местах</h2>
        <div class="cols-3">
        <div class="callout"><b>Интервал узковат</b>80% интервал на проверке накрыл факт в ${pct(f.cover[15], 0)} случаев через 15 мин и в ${pct(f.cover[120], 0)} через 2 часа. Июль и сентябрь были менее похожи на обычный день, чем февраль и май, на которых интервал считали.</div>
        <div class="callout"><b>Неожиданные перегрузки прогноз не ловит</b>Почти все перегрузки — плановые, утром с севера, и их видно уже по «обычному дню»: он сам по себе замечает ${pct(f.detect.all.plan.recall, 0)} при точности ${pct(f.detect.all.plan.precision, 0)}. Окон, где поток выше нормы и одновременно на 8%+ выше обычного, за июль и сентябрь было ${an.ratio.tp + an.ratio.fn}; прогноз не заметил ни одного заранее. Такие всплески начинаются резко, и за 15–120 минут по турникетам их не видно.</div>
        <div class="callout"><b>Вечер не измерить</b>Вечером тяжёлое направление — из центра. Сколько людей едет из центра, по входам не оценить: нужны выходы по станциям или датчики загрузки вагонов.</div>
        </div>
  </div>

  <details class="more"><summary>Что пробовали ещё: градиентный бустинг</summary>
  <div class="section">
        <p>Градиентный бустинг (LightGBM) по тем же данным: 12 признаков, обучение на феврале и мае. На уровне сектора он лучше на 0–0,3 п. п., на уровне станции — практически так же. Разница меньше, чем сдвиг от одной смены сезона, а объяснить решение диспетчеру сложнее. В продукте оставили прозрачную формулу, бустинг — как контрольный.</p>
        <table class="t" id="fc-gbm"></table>
  </div>
  </details>
  </div>`;

  example();
  for (const [id, sec] of [["fc-n", "north"], ["fc-s", "south"]]) horizonChart(document.getElementById(id), f.sector.filter(r => r.sec === sec));
  const g = f.sector_gbm;
  document.getElementById("fc-gbm").innerHTML = `<thead><tr><th>Горизонт</th><th>Сектор</th><th class="r">Обычный день</th><th class="r">Такт</th><th class="r">Бустинг</th></tr></thead><tbody>${
    g.filter(r => [30, 60, 120].includes(r.h)).map(r => `<tr><td>${r.h} мин</td><td>${r.sector === "north" ? "север" : "юг"}</td><td class="r">${pct(r.plan, 1)}</td><td class="r"><b>${pct(r.ratio, 1)}</b></td><td class="r">${pct(r.gbm, 1)}</td></tr>`).join("")
  }</tbody>`;
}

function horizonChart(node, rows) {
  const W = width(node, 280), H = 240, M = { t: 14, r: 34, b: 30, l: 46 };
  const x = d3.scaleLinear().domain([15, 120]).range([M.l, W - M.r]);
  const y = d3.scaleLinear().domain([0, 0.10]).range([H - M.b, M.t]);
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "grid").selectAll("line").data([0.025, 0.05, 0.075, 0.10]).join("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", d => y(d)).attr("y2", d => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l - 6},0)`).call(d3.axisLeft(y).tickValues([0, 0.025, 0.05, 0.075, 0.1]).tickSize(0).tickFormat(d => pct(d, 1)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 8})`).call(d3.axisBottom(x).tickValues([15, 30, 60, 90, 120]).tickSize(0).tickFormat(d => `${d} мин`));
  const ln = k => d3.line().defined(r => r[k] <= 0.105).x(r => x(r.h)).y(r => y(r[k]))(rows);
  svg.append("path").attr("d", ln("persist")).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-opacity", 0.7).attr("stroke-width", 2);
  svg.append("path").attr("d", ln("plan")).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 2).attr("stroke-dasharray", "5 4");
  svg.append("path").attr("d", ln("ratio")).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2.4);
  svg.selectAll("circle").data(rows).join("circle").attr("cx", r => x(r.h)).attr("cy", r => y(r.ratio)).attr("r", 4).attr("fill", "var(--ink)").attr("stroke", "var(--paper)").attr("stroke-width", 2)
    .on("mousemove", (ev, r) => tipShow(ev, `<b>через ${r.h} мин</b><br>Такт: <b>${pct(r.ratio, 1)}</b><br>обычный день: ${pct(r.plan, 1)}<br><span class="muted">как сейчас: ${pct(r.persist, 1)}</span>`))
    .on("mouseleave", tipHide);
}

function example() {
  const st = { i: 0, sec: "north", t: EX[0].t };
  const chart = document.getElementById("fx-chart"), slider = document.getElementById("fx-t");
  const draw = async () => {
    const ex = EX[st.i], d = await load(`day/${ex.d}.json`);
    document.getElementById("fx-note").textContent = ex.note;
    slider.value = st.t;
    document.getElementById("fx-tl").textContent = slotStr(st.t);
    const fa = d.load_plan[st.sec], ty = d.load_typ[st.sec];
    const dec_ = d.dec.find(e => e.t === st.t);
    const fc = dec_ ? dec_.fc[st.sec].map((v, k) => [st.t + 1 + k, v]) : [];
    const W = width(chart, 300), narrow = W < 640, H = narrow ? 260 : 320;
    const M = { t: 14, r: 14, b: 26, l: 44 };
    const x = d3.scaleLinear().domain([24, 88]).range([M.l, W - M.r]);
    const ymax = Math.max(1100, d3.max(fa.slice(24, 89)) || 0, d3.max(ty.slice(24, 89)) || 0, d3.max(fc, p => p[1]) || 0) * 1.05;
    const y = d3.scaleLinear().domain([0, ymax]).range([H - M.b, M.t]).nice();
    const svg = d3.select(chart).html("").append("svg").attr("width", W).attr("height", H);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 4})`)
      .call(d3.axisBottom(x).tickValues(d3.range(24, 89, narrow ? 16 : 8)).tickSize(0).tickFormat(slotStr));
    svg.append("g").attr("class", "axis grid").attr("transform", `translate(${M.l - 6},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(W - M.l - M.r + 6)).tickFormat(v => nfmt(v)));
    svg.append("rect").attr("x", x(st.t)).attr("y", M.t).attr("width", x(Math.min(88, st.t + 8)) - x(st.t)).attr("height", H - M.b - M.t).attr("fill", "var(--band)").attr("fill-opacity", 0.6);
    svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(960)).attr("y2", y(960)).attr("stroke", "var(--red)").attr("stroke-dasharray", "5 4").attr("stroke-width", 1.5);
    const ln = d3.line().defined(p => p[1] != null).x(p => x(p[0])).y(p => y(p[1]));
    const pts = (arr, a, b) => d3.range(a, b + 1).map(s => [s, arr[s]]);
    svg.append("path").attr("d", ln(pts(ty, 24, 88))).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-dasharray", "4 3").attr("stroke-width", 1.5);
    svg.append("path").attr("d", ln(pts(fa, st.t, 88))).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-opacity", 0.7).attr("stroke-width", 2);
    svg.append("path").attr("d", ln(pts(fa, 24, st.t))).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2);
    if (fc.length) {
      svg.append("path").attr("d", ln([[st.t, fa[st.t]], ...fc])).attr("fill", "none").attr("stroke", "var(--blue)").attr("stroke-width", 2.5);
      svg.selectAll("circle.f").data(fc).join("circle").attr("cx", p => x(p[0])).attr("cy", p => y(p[1])).attr("r", 3.5).attr("fill", "var(--blue)").attr("stroke", "var(--sheet)").attr("stroke-width", 2);
    }
    svg.append("line").attr("x1", x(st.t)).attr("x2", x(st.t)).attr("y1", M.t).attr("y2", H - M.b).attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
    svg.append("text").attr("x", x(st.t) + 6).attr("y", M.t + 12).style("font-weight", 700).style("fill", "var(--ink)").attr("class", "num").text(`сейчас ${slotStr(st.t)}`);
    // наведение: значения в слоте
    svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.b - M.t).attr("fill", "transparent")
      .on("mousemove", ev => {
        const s = Math.round(x.invert(d3.pointer(ev)[0])), f = fc.find(p => p[0] === s);
        tipShow(ev, `<b>${slotStr(s)}</b><br>факт ${nfmt(fa[s])}${s > st.t ? " (Такт ещё не знает)" : ""}<br>обычный день ${nfmt(ty[s])}${f ? `<br>прогноз Такта ${nfmt(f[1])}` : ""}`);
      }).on("mouseleave", tipHide);
    // итог по окну прогноза
    const r = document.getElementById("fx-read");
    if (!fc.length) { r.innerHTML = ""; return; }
    const err = arr => d3.sum(fc, p => Math.abs(arr(p) - fa[p[0]])) / Math.max(1, d3.sum(fc, p => fa[p[0]]));
    const eT = err(p => p[1]), eB = err(p => ty[p[0]]);
    const over = a => fc.filter(p => a(p) > 960).length;
    r.innerHTML = `<div><span>Ошибка на следующие 2 часа</span><b class="num">Такт ${pct(eT, 1)}</b><em>обычный день ${pct(eB, 1)}</em></div>
      <div><span>Интервалов выше нормы в окне</span><b class="num">прогноз ${over(p => p[1])} из 8</b><em>факт ${over(p => fa[p[0]])} из 8</em></div>`;
  };
  const nfmt = v => v == null ? "—" : fmt(v);
  document.getElementById("fx-days").addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    st.i = +b.dataset.i; st.t = EX[st.i].t;
    document.querySelectorAll("#fx-days button").forEach(x => x.classList.toggle("on", x === b)); draw();
  });
  document.getElementById("fx-sec").addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    st.sec = b.dataset.s; document.querySelectorAll("#fx-sec button").forEach(x => x.classList.toggle("on", x === b)); draw();
  });
  slider.addEventListener("input", () => { st.t = +slider.value; draw(); });
  draw();
}
