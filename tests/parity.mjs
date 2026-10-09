// Сверка расчёта в браузере (site/src/lib/engine.js) с Python по выгрузке: решения всех дней, статус, меры, загрузка.
// Запуск: node tests/parity.mjs  (после python3 pipeline/export.py)
import fs from "fs";
import path from "path";
import { runDay } from "../site/src/lib/engine.js";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "site", "public", "data");
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json")));
const files = fs.readdirSync(path.join(dir, "day")).sort();
let bad = 0, total = 0, loadDiff = 0, loadN = 0;
const show = [];
for (const f of files) {
  const day = JSON.parse(fs.readFileSync(path.join(dir, "day", f)));
  const { decs, P } = runDay(meta, day, { upto: 88, alpha: meta.c.alpha, auto: true });
  day.dec.forEach((py, i) => {
    const js = decs[i].dec;
    total++;
    const sig = d => JSON.stringify([d.status || d.s, (d.measures || d.m).map(m => [m.type, m.pairs ?? null, m.from ?? null, m.to ?? null, !!m.repeat])]);
    if (sig(js) !== sig(py)) { bad++; if (show.length < 8) show.push(`${day.date} t=${py.t}: py ${sig(py)} js ${sig(js)}`); }
    for (const sec of ["north", "south"]) py.fc[sec].forEach((v, k) => { loadN++; loadDiff = Math.max(loadDiff, Math.abs(v - js.sectors[sec].fc[k])); });
  });
  day.sys.forEach((v, k) => { if (Math.abs(v - P[k]) > 0.051) { bad++; if (show.length < 8) show.push(`${day.date} sys[${k}] py ${v} js ${P[k]}`); } });
}
console.log(`решений: ${total}, расхождений: ${bad}, наибольшее расхождение загрузки: ${loadDiff} чел., значений: ${loadN}`);
show.forEach(s => console.log(s));
process.exit(bad === 0 && loadDiff <= 1 ? 0 : 1);
