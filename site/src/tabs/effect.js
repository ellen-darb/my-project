import * as d3 from "d3";
import { load, fmt, pct, dec, monthName, tipShow, tipHide, width } from "../lib/util.js";

const mln = v => dec(v / 1e6, 1);
const GROUP = { weekday_sep: "Будни, учебный график", weekday_summer: "Будни, летний график", weekend: "Выходные" };
const CLS = { normal: "обычный", surge: "поток выше", drop: "поток ниже" };

export async function render(app) {
  const [e, ef] = await Promise.all([load("economics.json"), load("effect.json")]);
  const u = e.unit, b = e.base, c = e.cons, a = e.annual, S = e.sources;
  const src = k => `<a href="${S[k].u}" target="_blank" rel="noopener">${S[k].t}</a>`;
  app.innerHTML = `
  <div class="lede"><div>
    <p class="kicker">Эффект и деньги · год, линия 1</p>
    <h1>Такт не зарабатывает метро денег. Он тратит ${mln(-b.net)} млн ₽ в год, чтобы ${fmt(Math.round(a.dover / 1000))} тыс. поездок прошли в пределах нормы.</h1>
    <p class="sub">Выручка от того, что в вагоне свободнее, не растёт: тариф тот же, пассажиры едут всё равно. Поэтому считаем только то, что реально меняется в расходах, — поездо-часы, — и что за эти деньги получают пассажиры.</p>
  </div></div>

  <div class="section">
    <div class="big-row">
      <div class="big"><div class="v">−${mln(-b.net)}<small> млн ₽</small></div><div class="k">в год, базовый сценарий</div><div class="src">консервативный: −${mln(-c.net)} млн ₽</div></div>
      <div class="big"><div class="v">${fmt(Math.round(a.dover / 1000))}<small> тыс.</small></div><div class="k">поездок в год в пределах нормы вместо «сверх»</div><div class="src">по проигрыванию 120 дней на фактическом потоке</div></div>
      <div class="big"><div class="v">${fmt(b.per_relieved_pax)}<small> ₽</small></div><div class="k">за каждую такую поездку</div><div class="src">средняя поездка стоит метро ${fmt(u.cost_per_trip)} ₽; консервативно ${fmt(c.per_relieved_pax)} ₽</div></div>
      <div class="big"><div class="v">${dec(e.budget_share.base * 100, 3)}<small>%</small></div><div class="k">расходов метро на перевозку</div><div class="src">72,4 млрд ₽ в 2025 году</div></div>
    </div>
  </div>

  <div class="section">
    <div class="sec-head">
      <div><p class="kicker">Расходы и экономия</p><h2>Добавленные поездо-часы против снятых</h2></div>
      <p>Добавляем в основном утром: составы уходят в депо не в 09:00, а позже, и выпуск чуть раньше в 07:45. Снимаем в дни, когда поток ниже обычного на 12%+ и загрузка ниже 70% нормы. Экономия от снятия меньше цены добавления: машинист на смене всё равно, экономятся только энергия и ремонт.</p>
    </div>
    <div id="ef-bars"></div>
    <table class="t" style="margin-top:20px">
      <thead><tr><th></th><th class="r">Поездо-часов в год</th><th class="r">Базовый, ₽ за час</th><th class="r">Базовый, млн ₽</th><th class="r">Консервативный, ₽ за час</th><th class="r">Консервативный, млн ₽</th></tr></thead>
      <tbody>
        <tr><td>Добавить или удержать составы</td><td class="r">+${fmt(a.add_h)}</td><td class="r">${fmt(u.add_train_h.base)}</td><td class="r">−${mln(b.cost)}</td><td class="r">${fmt(u.add_train_h.cons)}</td><td class="r">−${mln(c.cost)}</td></tr>
        <tr><td>Снять составы в провалы потока</td><td class="r">−${fmt(a.cut_h)}</td><td class="r">${fmt(u.cut_train_h.base)}</td><td class="r">+${mln(b.save)}</td><td class="r">${fmt(u.cut_train_h.cons)}</td><td class="r">+${mln(c.save)}</td></tr>
        <tr><td><b>Итого</b></td><td class="r"><b>+${fmt(a.add_h - a.cut_h)}</b></td><td></td><td class="r"><b>−${mln(-b.net)}</b></td><td></td><td class="r"><b>−${mln(-c.net)}</b></td></tr>
      </tbody>
    </table>
    <p class="note">Консервативный сценарий: вся электроэнергия метро (не только тяга), амортизация вагонов, машинист с учётом отпуска до 45 дней, аномальных дней на 50% больше, а при снятии экономится только энергия на тягу.</p>
  </div>

  <div class="section">
    <div class="sec-head">
      <div><p class="kicker">Чувствительность</p><h2>От чего зависит сумма</h2></div>
      <p>Меняем по одному допущению, остальное как в базовом сценарии (−${mln(-e.sensitivity.base_net)} млн ₽, линия на графике). Главное — какую цену поездо-часа принять: с амортизацией вагонов расход вырастает в 2,3 раза. Больше аномальных дней не дороже, а дешевле: в дни провала Такт снимает составы.</p>
    </div>
    <div class="tor" id="ef-tor"></div>
  </div>

  <div class="section">
    <div class="cols-2">
      <div>
        <h2>Из чего цена поездо-часа</h2>
        <p>Час работы состава из 8 вагонов при скорости в обороте ${dec(u.speed_kmh, 1)} км/ч (2 × 29,6 км за 99 мин) — это ${fmt(u.car_km_per_train_h)} вагоно-км.</p>
        <table class="t">
          <thead><tr><th>Статья</th><th class="r">₽ на вагоно-км</th><th>Как получено</th></tr></thead>
          <tbody>
            <tr><td>Энергия на тягу</td><td class="r">${dec(u.rub_per_car_km.energy_traction)}</td><td>6,1 млрд ₽ / 232 млн вагоно-км × 70% на тягу</td></tr>
            <tr><td>Вся электроэнергия</td><td class="r">${dec(u.rub_per_car_km.energy_all)}</td><td>6,1 млрд ₽ / 232 млн вагоно-км (консерв.)</td></tr>
            <tr><td>Ремонт подвижного состава</td><td class="r">${dec(u.rub_per_car_km.repair)}</td><td>5,2 млрд ₽ / 232 млн</td></tr>
            <tr><td>Амортизация</td><td class="r">${dec(u.rub_per_car_km.amort)}</td><td>8,4 млрд ₽ / 232 млн (только консерв.)</td></tr>
            <tr><td>Для сравнения: полная себестоимость</td><td class="r">${dec(u.rub_per_car_km.full_plan, 0)}–${dec(u.rub_per_car_km.full_fact, 0)}</td><td>58,8 млрд план / 72,4 млрд факт на 232 млн; включает станции, эскалаторы, управление</td></tr>
          </tbody>
        </table>
        <p>Машинист: 155 тыс. ₽ в месяц × ${dec(1 + 7.2 / 23.4, 2)} взносы / 165 ч = <b>${fmt(u.driver_h.base)} ₽/ч</b>; с отпуском и резервом ${fmt(u.driver_h.cons)} ₽/ч.</p>
        <div class="callout"><b>Почему не полная себестоимость</b>Если умножить ${fmt(u.add_train_h.full_cost)} ₽ полной себестоимости часа на добавленные часы, расход вышел бы в ${dec(u.add_train_h.full_cost / u.add_train_h.base, 1)} раза больше. Но станции, эскалаторы и управление работают одинаково, сколько бы составов ни шло. Меняются только энергия, ремонт и смена машиниста.</div>
      </div>
      <div>
        <h2>Год по типам дней</h2>
        <p>Средние на день взяты из проигрывания 120 дней с 15-минутными турникетами; частота аномалий — из почасового файла за 9 месяцев (${e.anomaly.anomalous_days} из ${e.anomaly.unplanned_days} неплановых дней).</p>
        <table class="t">
          <thead><tr><th>Дни</th><th class="r">В году</th><th class="r">+ч/день</th><th class="r">−ч/день</th><th class="r">Поездок в норме, в день</th></tr></thead>
          <tbody>${e.by_type.map(r => `<tr><td>${GROUP[r.group]}, ${CLS[r.cls]}</td><td class="r">${fmt(r.days)}</td><td class="r">${dec(r.add_h)}</td><td class="r">${dec(r.cut_h)}</td><td class="r">${fmt(r.dover)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="note">В выходные загрузка на измеримых перегонах ниже нормы, поэтому там Такт только снимает составы, если поток ниже обычного, и ничего не добавляет.</p>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="cols-2">
      <div>
        <h2>Чего в расчёте нет</h2>
        <ul class="src-list" style="font-size:15px;color:var(--ink)">
          <li><b>Выручка.</b> Давка не меняет число оплаченных поездок, поэтому доход 0.</li>
          <li><b>Время пассажиров в рублях.</b> Ожидания меньше на ${fmt(a.dwait_h)} пассажиро-часов в год, но утверждённой Минтрансом цены часа нет, есть только проект методики НИИАТ. В деньги не переводим.</li>
          <li><b>Вечер и центр.</b> Загрузку из центра и на пересадочных станциях по входам не оценить. Если там места больше, чем кажется, можно снимать больше составов; если меньше — наоборот. Это проверяется датчиками загрузки вагонов.</li>
          <li><b>Покупка составов.</b> В утренний пик она не помогает: предел — интервал 1:53, а не парк (на линии и так 53 из 53). Вагон стоит более 255 млн ₽ с лизингом.</li>
        </ul>
      </div>
      <div>
        <h2>Пилот и сопровождение</h2>
        <table class="t">
          <thead><tr><th>Роль</th><th class="r">₽ в мес. (hh.ru)</th><th class="r">Занятость</th></tr></thead>
          <tbody>${e.pilot.team.map(([r, s, k]) => `<tr><td>${r}</td><td class="r">${fmt(s)}</td><td class="r">${k === 1 ? "полная" : "половина"}</td></tr>`).join("")}</tbody>
        </table>
        <p>Пилот на линии 1 — ${e.pilot.months} месяца: <b>${mln(e.pilot.rub)} млн ₽</b> с взносами. Сопровождение — половина ставки аналитика: <b>${mln(e.pilot.support_year)} млн ₽ в год</b>. Состав команды — наше допущение, ставки — медианы hh.ru за I квартал 2026. Серверы — существующие у метро, данные турникетов уже собираются.</p>
        <p>Результат пилота, который можно проверить: предложение к листу графика с 09:00 → 09:30 и журнал рекомендаций против решений диспетчера.</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>120 дней на фактическом потоке</h2>
    <p>Что было бы, если бы диспетчер принимал рекомендации Такта: каждые 15 минут прогноз, решение, применение к парности, а пассажиры — фактические.</p>
    <table class="t" id="ef-months"></table>
  </div>

  <div class="section">
    <h2>Источники</h2>
    <ol class="src-list">${Object.keys(S).map(k => `<li>${src(k)}</li>`).join("")}</ol>
  </div>`;

  document.getElementById("ef-months").innerHTML = `<thead><tr><th>Месяц</th><th class="r">Дней</th><th class="r">Поездок сверх нормы по графику</th><th class="r">С мерами Такта</th><th class="r">Изменение</th><th class="r">Поездо-часов</th></tr></thead><tbody>${ef.months.map(m => `<tr><td>${monthName(m.m)}</td><td class="r">${m.d}</td><td class="r">${fmt(m.plan_over_pax)}</td><td class="r">${fmt(m.system_over_pax)}</td><td class="r">${pct(m.system_over_pax / m.plan_over_pax - 1)}</td><td class="r">${m.system_train_h - m.plan_train_h >= 0 ? "+" : ""}${fmt(m.system_train_h - m.plan_train_h)}</td></tr>`).join("")}</tbody>`;
  tornado(document.getElementById("ef-tor"), e.sensitivity);
  bars(document.getElementById("ef-bars"), [
    { k: "Базовый", cost: b.cost, save: b.save, net: b.net },
    { k: "Консервативный", cost: c.cost, save: c.save, net: c.net },
  ]);
}

function bars(node, rows) {
  const W = width(node, 300), narrow = W < 640;
  const M = { t: 10, r: 20, b: 26, l: narrow ? 100 : 150 }, rowH = 56, H = M.t + M.b + rowH * rows.length;
  const lo = d3.min(rows, r => -r.cost), hi = d3.max(rows, r => r.save);
  const x = d3.scaleLinear().domain([lo * 1.05, Math.max(hi * 1.3, -lo * 0.25)]).range([M.l, W - M.r]);
  const svg = d3.select(node).html("").append("svg").attr("width", W).attr("height", H);
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", M.t - 4).attr("y2", H - M.b).attr("stroke", "var(--ink)");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b + 6})`).call(d3.axisBottom(x).ticks(narrow ? 4 : 7).tickSize(0).tickFormat(v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${dec(Math.abs(v) / 1e6, 0)} млн`));
  rows.forEach((r, i) => {
    const y = M.t + i * rowH;
    svg.append("text").attr("x", M.l - 12).attr("y", y + 22).attr("text-anchor", "end").style("font-weight", 600).style("fill", "var(--ink)").text(r.k);
    svg.append("rect").attr("x", x(-r.cost)).attr("y", y + 6).attr("width", x(0) - x(-r.cost)).attr("height", 14).attr("rx", 3).attr("fill", "var(--red)")
      .on("mousemove", ev => tipShow(ev, `${r.k}: добавленные часы −${mln(r.cost)} млн ₽`)).on("mouseleave", tipHide);
    svg.append("rect").attr("x", x(0) + 2).attr("y", y + 6).attr("width", x(r.save) - x(0)).attr("height", 14).attr("rx", 3).attr("fill", "var(--blue)")
      .on("mousemove", ev => tipShow(ev, `${r.k}: снятые часы +${mln(r.save)} млн ₽`)).on("mouseleave", tipHide);
    svg.append("rect").attr("x", x(r.net)).attr("y", y + 26).attr("width", x(0) - x(r.net)).attr("height", 8).attr("rx", 2).attr("fill", "var(--ink)");
    svg.append("text").attr("x", x(r.net) - 6).attr("y", y + 34).attr("text-anchor", "end").style("font-weight", 700).style("fill", "var(--ink)").attr("class", "num")
      .text(`итого −${mln(-r.net)} млн ₽`);
    svg.append("text").attr("x", x(r.save) + 6).attr("y", y + 18).style("fill", "var(--ink-2)").text(`+${mln(r.save)}`);
  });
}

function tornado(node, sens) {
  const all = sens.rows.flatMap(r => [r.lo_net, r.hi_net]).concat(sens.base_net);
  const x0 = d3.min(all) * 1.06;
  const v = n => `−${mln(-n)}`;
  node.innerHTML = `<div class="tor-row tor-head"><div></div><svg class="tor-axis"></svg><div class="tor-v">млн ₽ в год</div></div>` +
    sens.rows.map((r, i) => `<div class="tor-row"><div class="tor-k">${r.driver}</div><svg class="tor-bar" data-i="${i}"></svg>
      <div class="tor-v"><span><b class="num">${v(r.lo_net)}</b> ${r.lo_label}</span><span><b class="num">${v(r.hi_net)}</b> ${r.hi_label}</span></div></div>`).join("");
  const draw = (svgEl, fn) => {
    const W = Math.max(120, svgEl.getBoundingClientRect().width), H = +getComputedStyle(svgEl).height.replace("px", "") || 28;
    const x = d3.scaleLinear().domain([x0, 0]).range([2, W - 10]);
    const svg = d3.select(svgEl).attr("width", W).attr("height", H).html("");
    fn(svg, x, W, H);
  };
  draw(node.querySelector(".tor-axis"), (svg, x, W, H) => {
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - 4})`)
      .call(d3.axisTop(x).ticks(W < 260 ? 3 : 5).tickSize(0).tickFormat(t => t === 0 ? "0" : `−${dec(-t / 1e6, 0)}`));
  });
  node.querySelectorAll(".tor-bar").forEach(el => draw(el, (svg, x, W, H) => {
    const r = sens.rows[+el.dataset.i], a = Math.min(r.lo_net, r.hi_net), b = Math.max(r.lo_net, r.hi_net);
    const y = H / 2 - 7, base = sens.base_net;
    svg.append("rect").attr("x", 0).attr("y", y).attr("width", W).attr("height", 14).attr("fill", "var(--rule-2)").attr("rx", 3);
    if (a < base) svg.append("rect").attr("x", x(a)).attr("y", y).attr("width", Math.max(2, x(Math.min(b, base)) - x(a) - 1)).attr("height", 14).attr("rx", 3).attr("fill", "var(--red)");
    if (b > base) svg.append("rect").attr("x", x(Math.max(a, base)) + 1).attr("y", y).attr("width", Math.max(2, x(b) - x(Math.max(a, base)) - 1)).attr("height", 14).attr("rx", 3).attr("fill", "var(--blue)");
    svg.append("line").attr("x1", x(base)).attr("x2", x(base)).attr("y1", 0).attr("y2", H).attr("stroke", "var(--ink)").attr("stroke-width", 2);
    svg.append("rect").attr("x", 0).attr("y", 0).attr("width", W).attr("height", H).attr("fill", "transparent")
      .on("mousemove", ev => tipShow(ev, `<b>${r.driver}</b><br>${r.lo_label}: ${v(r.lo_net)} млн ₽, ${fmt(r.lo_pp)} ₽ за поездку<br>${r.hi_label}: ${v(r.hi_net)} млн ₽, ${fmt(r.hi_pp)} ₽ за поездку`))
      .on("mouseleave", tipHide);
  }));
}
