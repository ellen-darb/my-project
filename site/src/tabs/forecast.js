import * as d3 from "d3";
import { load, fmt, pct, dec, tipShow, tipHide, width } from "../lib/util.js";

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
    <div class="cols-2">
      <div>
        <h2>Что пробовали ещё</h2>
        <p>Градиентный бустинг (LightGBM) по тем же данным: 12 признаков, обучение на феврале и мае. На уровне сектора он лучше на 0–0,3 п. п., на уровне станции — практически так же. Разница меньше, чем сдвиг от одной смены сезона, а объяснить решение диспетчеру сложнее. В продукте оставили прозрачную формулу, бустинг — как контрольный.</p>
        <table class="t" id="fc-gbm"></table>
      </div>
      <div>
        <h2>Честно о слабых местах</h2>
        <div class="callout"><b>Интервал узковат</b>80% интервал на проверке накрыл факт в ${pct(f.cover[15], 0)} случаев через 15 мин и в ${pct(f.cover[120], 0)} через 2 часа. Июль и сентябрь были менее похожи на обычный день, чем февраль и май, на которых интервал считали.</div>
        <div class="callout"><b>Неожиданные перегрузки прогноз не ловит</b>Почти все перегрузки — плановые, утром с севера, и их видно уже по «обычному дню»: он сам по себе замечает ${pct(f.detect.all.plan.recall, 0)} при точности ${pct(f.detect.all.plan.precision, 0)}. Окон, где поток выше нормы и одновременно на 8%+ выше обычного, за июль и сентябрь было ${an.ratio.tp + an.ratio.fn}; прогноз не заметил ни одного заранее. Такие всплески начинаются резко, и за 15–120 минут по турникетам их не видно.</div>
        <div class="callout"><b>Вечер не измерить</b>Вечером тяжёлое направление — из центра. Сколько людей едет из центра, по входам не оценить: нужны выходы по станциям или датчики загрузки вагонов.</div>
      </div>
    </div>
  </div>`;

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
  svg.append("path").attr("d", ln("persist")).attr("fill", "none").attr("stroke", "var(--unknown)").attr("stroke-width", 2);
  svg.append("path").attr("d", ln("plan")).attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 2).attr("stroke-dasharray", "5 4");
  svg.append("path").attr("d", ln("ratio")).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2.4);
  svg.selectAll("circle").data(rows).join("circle").attr("cx", r => x(r.h)).attr("cy", r => y(r.ratio)).attr("r", 4).attr("fill", "var(--ink)").attr("stroke", "var(--paper)").attr("stroke-width", 2)
    .on("mousemove", (ev, r) => tipShow(ev, `<b>через ${r.h} мин</b><br>Такт: <b>${pct(r.ratio, 1)}</b><br>обычный день: ${pct(r.plan, 1)}<br><span class="muted">как сейчас: ${pct(r.persist, 1)}</span>`))
    .on("mouseleave", tipHide);
}
