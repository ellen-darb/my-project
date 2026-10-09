/* Расчёт загрузки и решение диспетчера — один в один pipeline/engine.py и pipeline/simulate.py.
   Сайт пересчитывает день на лету: принятое и отклонённое решение меняет парность, а значит и всё дальнейшее.
   Совпадение с Python проверяет tests/parity.mjs по выгрузке каждого дня. */

export const SLOTS = 96, WIN = 8, FIRST = 24, LAST = 87;      // слоты по 15 минут, решения с 06:00 до 21:45

const bank = x => {                                              // как numpy.round: .5 — к чётному
  const f = Math.floor(x), d = x - f;
  return d < 0.5 - 1e-12 ? f : d > 0.5 + 1e-12 ? f + 1 : (f % 2 === 0 ? f : f + 1);
};
export const trainsOnLine = p => bank(p * 99 / 60);
export const trainsFor = p => Math.ceil(p * 99 / 60 - 1e-9);
export const pairsFor = n => Math.floor(n * 60 / 99 + 1e-9);

/* Входы в слотах -> поток через перегон с краем edge к центру, со сдвигом на время в пути.
   stations — индексы станций сектора, E[слот][станция]. */
export function sectionFlow(E, stations, edge, segMin, alpha) {
  const out = new Float64Array(SLOTS);
  for (const st of stations) {
    const lag = 2 + Math.abs(st - edge) * segMin;
    const kf = Math.floor(lag / 15), f = lag / 15 - kf;
    for (let s = 0; s + kf < SLOTS; s++) out[s + kf] += (1 - f) * E[s][st];
    for (let s = 0; s + kf + 1 < SLOTS; s++) out[s + kf + 1] += f * E[s][st];
  }
  return out.map(v => v * alpha);
}

/* Края перегонов по секторам. Критические: север 10.5 (Пл. Ленина → Чернышевская), юг 4.5 (Нарвская → Балтийская).
   Для схемы линии те же формулы для каждого перегона k: север — станции выше по ходу, юг — ниже. */
export function sectorOf(meta, sec) {
  const m = meta.sectors[sec];
  return { stations: m.stations, edge: meta.engine.edges[sec] };
}

export function perTrain(flow, pairs) {
  return flow.map((f, s) => { const n = pairs[s] / 4; return n > 0 ? f / n : 0; });
}

/* загрузка состава к центру в каждом слоте на критическом перегоне сектора */
export function sectorLoad(meta, E, pairs, sec, alpha) {
  const { stations, edge } = sectorOf(meta, sec);
  return perTrain(sectionFlow(E, stations, edge, meta.engine.seg_min, alpha), pairs);
}

/* загрузка перегона k (между станциями k и k+1) к центру: north — k ≥ 10, south — k ≤ 4 */
export function segmentLoad(meta, E, pairs, k, alpha) {
  const north = k >= 10;
  const st = north ? meta.sectors.north.stations.filter(i => i > k) : meta.sectors.south.stations.filter(i => i <= k);
  return perTrain(sectionFlow(E, st, k + 0.5, meta.engine.seg_min, alpha), pairs);
}

/* Прогноз входов: база × (1 + w(h)·(поправка за последний час − 1)), как simulate.forecast */
export function forecastEntries(x, b, t, w) {
  const S = x[0].length, E = x.map(r => r.slice());
  const r = new Array(S).fill(0).map((_, s) => {
    let xs = 30, bs = 30;
    for (let k = t - 3; k <= t; k++) { xs += x[k][s]; bs += b[k][s]; }
    return xs / bs;
  });
  for (let k = t + 1; k < x.length; k++) {
    const h = Math.min(8, k - t), wh = w[h];
    for (let s = 0; s < S; s++) E[k][s] = b[k][s] * (1 + wh * (r[s] - 1));
  }
  // как в Python: (сумма факта + 30) / (сумма базы + 30) по всей линии
  let X = 0, B = 0;
  for (let k = t - 3; k <= t; k++) for (let s = 0; s < S; s++) { X += x[k][s]; B += b[k][s]; }
  return { E, lr: (X + 30) / (B + 30) };
}

const tStr = slot => { const m = slot * 15; return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const maxOf = a => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const sum = a => a.reduce((s, v) => s + v, 0);

/* Решение в момент t. pairs — действующая парность (с принятыми мерами), plan — лист графика. */
export function decide(meta, pairs, weekend, E, Bd, t, lineRatio, plan, alpha) {
  const c = meta.c, en = meta.engine, NORM = c.norm;
  const win = []; for (let s = t + 1; s < Math.min(t + 1 + WIN, SLOTS); s++) win.push(s);
  const out = { t, status: "ok", sectors: {}, measures: [], checks: [] };
  let worst = null;
  const nMorn = win.filter(s => s < en.morning_end).length;
  for (const sec of ["north", "south"]) {
    const Lf = sectorLoad(meta, E, pairs, sec, alpha), Lt = sectorLoad(meta, Bd, pairs, sec, alpha);
    const fc = win.map(s => Lf[s]), typ = win.map(s => Lt[s]);
    out.sectors[sec] = { fc: fc.map(Math.round), typ: typ.map(Math.round) };
    const over = win.map((s, i) => s < en.morning_end && fc[i] > NORM);
    const anomal = win.map((s, i) => over[i] && fc[i] > 1.08 * typ[i]);
    if (sum(over.map(Number)) >= 2) {
      const score = [sum(anomal.map(Number)), maxOf(fc)];
      if (!worst || score[0] > worst.score[0] || (score[0] === worst.score[0] && score[1] > worst.score[1]))
        worst = { score, sec, over, anomal, Lf: fc };
    }
  }
  const rel = lineRatio > 1.15 ? "high" : lineRatio < 0.85 ? "low" : null;
  const hour = Math.floor((t + 1) * 15 / 60);

  if (!worst) {
    if (rel === "high") {
      const peak = nMorn ? maxOf(["north", "south"].map(s => maxOf(out.sectors[s].fc.slice(0, nMorn)))) : 0;
      out.status = "watch";
      out.window = { sector: "line", from: win[0], to: win[win.length - 1], lead_min: 15, peak: Math.round(peak) };
      out.measures.push({ type: "watch",
        text: nMorn ? `Составы не добавлять: к центру до ${Math.round(peak)} чел. в составе (${Math.round(peak / NORM * 100)}% нормы)`
          : "Людей больше обычного, загрузку составов по входам оценить нельзя",
        why: "поток выше обычного, но там, где загрузку можно оценить, место есть; по центру и вечером — доклады дежурных станций" });
    } else if (rel === "low" && hour >= en.cut_hours[0] && hour < en.cut_hours[1]) {
      const Lmax = maxOf(["north", "south"].map(s => maxOf(out.sectors[s].fc)));
      const pNow = pairs[t + 1];
      const floor = (weekend ? en.min_pairs.weekend : en.min_pairs.weekday)[hour];
      const target = Math.max(Math.ceil(floor), Math.ceil(pNow * lineRatio / 0.95));
      const cut = Math.trunc(pNow - target);
      if (cut >= 2 && Lmax < 0.7 * NORM) {
        const tr = Math.floor(cut * c.turnover / 60);
        out.status = "low";
        out.measures.push({ type: "cut", pairs: cut, trains: tr, from: t + 1, to: win[win.length - 1],
          text: `Снять ${tr} сост. в депо, −${cut} пар/ч`,
          why: `поток ${Math.round((lineRatio - 1) * 100)}% к обычному дню; загрузка остаётся ниже 70% нормы, интервал в пределах графика` });
      }
    }
    return out;
  }

  const { sec, over, anomal, Lf } = worst;
  const idx = over.map((v, i) => v ? i : -1).filter(i => i >= 0);
  const s0 = win[idx[0]], s1 = win[idx[idx.length - 1]];
  const mult = maxOf(idx.map(i => Lf[i])) / NORM;
  out.status = sum(anomal.map(Number)) >= 2 ? "anomaly" : "structural";
  const lead = (s0 - t - 1) * 15;
  const pNow = pairs[t];
  let pS0 = pairs[s0];
  const need = Math.max(0, Math.ceil(pS0 * mult) - pS0);
  out.window = { sector: sec, from: s0, to: s1, lead_min: lead, pairs: pS0, trains: trainsOnLine(pS0), need_pairs: need, peak: Math.round(mult * NORM) };
  if (Math.min(...pairs.slice(s0, s1 + 1)) < pNow) {
    out.measures.push({ type: "hold", pairs: pNow, from: t + 1, to: s1,
      text: `Не снимать составы до ${tStr(s1 + 1)}: держать ${pNow} пар/ч`,
      why: "по графику парность снижается, а поток ещё выше нормы; составы уже на линии, ввод не нужен" });
    pS0 = Math.max(pS0, pNow);
  }
  const first = t + 1 + Math.ceil(c.hot_lead / 15), start = Math.max(s0, first);
  const headroom = Math.floor(c.max_pairs) - pS0;
  const free = Math.trunc(c.max_trains - trainsOnLine(pS0));
  const coldOk = (start - (t + 1)) * 15 >= c.cold_lead;
  const hotCap = en.hot_cap[sec] ?? en.hot_cap.line;
  const capTrains = coldOk ? free : Math.min(free, hotCap);
  const add = Math.trunc(Math.min(need, Math.max(headroom, 0), pairsFor(Math.max(capTrains, 0))));
  out.checks = [
    { rule: "Запас по интервалу 1:53", ok: headroom > 0, note: `${pS0} из 31,9 пар/ч` },
    { rule: "Свободные составы", ok: free > 0, note: `на линии ${trainsOnLine(pS0)} из ${c.max_trains}` },
    { rule: "Резерв успевает", ok: start <= s1 && lead >= c.hot_lead, note: `${lead} мин до начала, выход 15–20` },
  ];
  if (start > s1 && need > 0 && headroom > 0 && free > 0) {
    out.measures.push({ type: "late", text: `Резерв не успеет: тесно станет через ${lead} мин, состав выйдет не раньше ${tStr(first)}`,
      why: "предупредите станции участка и дежурных по станции; выпуск новых составов уже не поможет" });
  } else if (add > 0) {
    const tr = trainsFor(add);
    const depot = { north: "Северное", south: "Автово" }[sec] || "Автово и Северное";
    const early = trainsOnLine(plan[Math.min(s0 + 4, 95)]) - trainsOnLine(plan[s0]) >= tr;
    out.measures.push({ type: "add", pairs: add, trains: tr, depot, from: start, to: s1, hot: Math.min(tr, 4), on_time: lead >= c.hot_lead, early,
      text: early ? `Выпустить ${tr} сост. раньше графика из депо ${depot}, +${add} пар/ч` : `Выдать ${tr} сост. из резерва депо ${depot}, +${add} пар/ч`,
      why: lead >= c.hot_lead ? `резерв выходит за 15–20 мин и успевает; начало с ${tStr(start)}`
        : `тесно станет через ${lead} мин: резерв успеет к ${tStr(start)}, дальше окно ещё идёт` });
  } else if (!out.measures.length || headroom <= 0 || free <= 0) {
    out.measures.push({ type: "limit", text: "Составы не добавить: линия на пределе пропускной способности",
      why: "предупредить станции сектора и подготовить регулирование входа на самых загруженных вестибюлях" });
  }
  return out;
}

/* применить меры к парности (как simulate.run_day) */
export function applyMeasures(P, plan, measures, maxPairs) {
  for (const m of measures) {
    const a = m.from, b = m.to;
    for (let k = a; k <= b && k < SLOTS; k++) {
      if (m.type === "hold") P[k] = Math.max(P[k], m.pairs);
      else if (m.type === "add") P[k] = Math.min(Math.max(P[k], plan[k] + m.pairs), Math.floor(maxPairs));
      else if (m.type === "cut") P[k] = Math.min(P[k], plan[k] - m.pairs);
    }
  }
  return P;
}

export const ACTIONABLE = new Set(["hold", "add", "cut"]);

/* Проигрывание дня до слота upto с решениями диспетчера.
   journal: слот -> {act: "accept"|"reject"|"snooze", until}. Нет записи: в режиме показа (auto) совет считается принятым,
   пока диспетчер не откажется, в рабочем режиме — не принятым.
   Возвращает действующую парность перед решением в upto, решения всех слотов и отказы. */
export function runDay(meta, day, { upto, alpha, journal = {}, auto = true, wRatio = meta.w_ratio }) {
  const plan = day.plan, weekend = day.sched === "weekend";
  const P = plan.slice();
  const decs = [], declined = {}, prev = {};
  for (let t = FIRST; t <= Math.min(upto, LAST); t++) {
    const { E, lr } = forecastEntries(day.x, day.b, t, wRatio);
    const dec = decide(meta, P.slice(), weekend, E, day.b, t, lr, plan, alpha);
    dec.line_ratio = lr;
    // отказ действует, пока длится мера: тот же совет не возвращается
    for (const m of dec.measures) {
      const until = declined[m.type];
      if (ACTIONABLE.has(m.type) && until != null && m.from <= until) m.declined = true;
    }
    for (const m of dec.measures) {      // та же мера в соседних слотах — «действует», а не новый совет
      if (["limit", "watch", "late"].includes(m.type)) { m.repeat = (prev[m.type] ?? -9) >= t - 1; prev[m.type] = t; }
    }
    decs.push({ dec, E });
    if (t < upto) {
      const j = journal[t];
      const take = j ? j.act === "accept" : auto;
      if (j && j.act === "reject") for (const m of dec.measures) if (ACTIONABLE.has(m.type)) declined[m.type] = Math.max(declined[m.type] ?? -1, m.to);
      if (take) applyMeasures(P, plan, dec.measures.filter(m => ACTIONABLE.has(m.type) && !m.declined), meta.c.max_pairs);
    }
  }
  return { P, plan, decs };
}
