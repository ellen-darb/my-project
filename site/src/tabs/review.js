import { load, slotStr, dayLong, weekdayS, parseDay, monthName } from "../lib/util.js";
import { getDay, daysWithEntries, clearDay, ACT } from "../lib/journal.js";
import { runDay, ACTIONABLE, LAST } from "../lib/engine.js";
import * as d3 from "d3";
import { plain } from "../lib/plain.js";

const STATUS = {
  ok: ["var(--green)", "Составов хватает"], structural: ["var(--amber)", "Тесно по графику"],
  anomaly: ["var(--red)", "Людей больше обычного"], low: ["var(--blue)", "Можно убрать составы"], watch: ["var(--amber)", "Людей больше обычного"],
};

/* Разбор дня: что советовал Такт и что решил диспетчер. Журнал живёт в этом браузере и меняет расчёт дня на «Пульте». */
export async function render(app, params) {
  const [days, meta] = await Promise.all([load("days.json"), load("meta.json")]);
  const logged = daysWithEntries();
  let d = params.get("d") || logged[logged.length - 1] || "2026-09-15";
  app.innerHTML = `
    <div class="lede"><div>
      <p class="kicker">Журнал решений</p>
      <h1>Разбор дня: совет и решение</h1>
      <p class="sub">Все новые советы Такта за день и что с ними сделал диспетчер. Журнал хранится только в этом браузере.</p>
    </div><label class="daysel">День <select id="r-date"></select></label></div>
    <div id="r-body" class="section"></div>`;
  const sel = document.getElementById("r-date");
  sel.innerHTML = [...d3.group(days, x => parseDay(x.d).getMonth() + 1)].map(([m, list]) =>
    `<optgroup label="${monthName(m)}">${list.map(x => `<option value="${x.d}">${dayLong(x.d)}, ${weekdayS(x.d)}${logged.includes(x.d) ? " ●" : ""}</option>`).join("")}</optgroup>`).join("");
  sel.value = d;
  sel.onchange = () => { d = sel.value; history.replaceState(null, "", `#review?d=${d}`); draw(); };

  async function draw() {
    const day = await load(`day/${d}.json`);
    const log = getDay(d);
    const run = runDay(meta, day, { upto: LAST + 1, alpha: meta.c.alpha, journal: log, auto: true });
    const rows = run.decs.map(r => r.dec).filter(x => x.measures.some(m => !m.repeat));
    const doable = rows.filter(r => r.measures.some(m => ACTIONABLE.has(m.type)));
    const cnt = a => Object.values(log).filter(e => e.act === a).length;
    const perHour = d3.max(d3.rollup(doable, v => v.length, r => Math.floor((r.t + 1) / 4)).values()) || 0;
    document.getElementById("r-body").innerHTML = `
      <div class="review-sum">
        <div><b>${doable.length}</b>советов к действию</div>
        <div><b>${cnt("accept")}</b>принято</div>
        <div><b>${cnt("snooze")}</b>отложено</div>
        <div><b>${cnt("reject")}</b>не нужно</div>
        <div><b>${perHour}</b>советов в час, не больше</div>
      </div>
      ${rows.length ? `<div class="tscroll"><table class="review-table"><thead><tr><th>Время</th><th>Состояние</th><th>Совет</th><th>Почему</th><th>Решение</th></tr></thead><tbody>
      ${rows.map(r => { const e = log[r.t]; const [c, l] = STATUS[r.status] || STATUS.ok;
        const ms = r.measures.filter(m => !m.repeat);
        const can = ms.some(m => ACTIONABLE.has(m.type) && !m.declined);
        return `<tr><td class="tab-num">${slotStr(r.t + 1)}</td><td class="st"><i style="background:${c}"></i>${l}</td>
        <td>${ms.map(m => plain(m.text)).join("<br>")}</td><td>${ms.map(m => plain(m.why)).join("<br>")}</td>
        <td class="dcs">${e ? `${ACT[e.act]}${e.reason ? `<br><span class="note">${e.reason}</span>` : ""}` : `<span class="note">${can ? "без решения" : "информация, решение не нужно"}</span>`}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="sub">В этот день Такт не предлагал менять график.</p>`}
      <p class="note" style="margin-top:18px">Записи появляются, когда на «Пульте» нажимают «Принять», «Напомнить через 15 мин» или «Не нужно». Принятое и отклонённое сразу меняет расчёт дня. ${logged.includes(d) ? `<button class="linkbtn" id="r-clear">Очистить записи этого дня</button>` : (logged.length ? "" : "Пока записей нет.")}</p>`;
    const cl = document.getElementById("r-clear");
    if (cl) cl.onclick = () => { clearDay(d); draw(); };
  }
  await draw();
}
