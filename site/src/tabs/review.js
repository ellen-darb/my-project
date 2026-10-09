import { load, fmt, slotStr, hhmm, dayLong, weekday, weekdayS, parseDay, monthName } from "../lib/util.js";
import { getDay, daysWithEntries, ACT } from "../lib/journal.js";
import * as d3 from "d3";
import { plain } from "../lib/plain.js";

const STATUS = {
  ok: ["var(--green)", "Поездов хватает"], structural: ["var(--amber)", "Тесно по графику"],
  anomaly: ["var(--red)", "Людей больше обычного"], low: ["var(--blue)", "Можно убрать поезда"],
};

/* Разбор дня: что советовал Такт и что решил диспетчер. Журнал живёт в этом браузере. */
export async function render(app, params) {
  const [days] = await Promise.all([load("days.json")]);
  const logged = daysWithEntries();
  let d = params.get("d") || logged[logged.length - 1] || "2026-09-15";
  app.innerHTML = `
    <div class="lede"><div>
      <p class="kicker">Журнал решений</p>
      <h1>Разбор дня: совет и решение</h1>
      <p class="sub">Все советы Такта за день и что с ними сделал диспетчер. Журнал хранится только в этом браузере.</p>
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
    const rows = day.dec.filter(x => x.m.length);
    const cnt = a => Object.values(log).filter(e => e.act === a).length;
    const perHour = d3.max(d3.rollup(rows, v => v.length, r => Math.floor(r.t / 4)).values()) || 0;
    document.getElementById("r-body").innerHTML = `
      <div class="review-sum">
        <div><b>${rows.length}</b>советов за день</div>
        <div><b>${cnt("accept")}</b>принято</div>
        <div><b>${cnt("defer")}</b>отложено</div>
        <div><b>${cnt("reject")}</b>не нужно</div>
        <div><b>${perHour}</b>советов в час, не больше</div>
      </div>
      ${rows.length ? `<table class="review-table"><thead><tr><th>Время</th><th>Состояние</th><th>Совет</th><th>Почему</th><th>Решение</th></tr></thead><tbody>
      ${rows.map(r => { const e = log[r.t]; const [c, l] = STATUS[r.s];
        return `<tr><td class="tab-num">${slotStr(r.t + 1)}</td><td class="st"><i style="background:${c}"></i>${l}</td>
        <td>${r.m.map(m => plain(m.text)).join("<br>")}</td><td>${r.m.map(m => plain(m.why)).join("<br>")}</td>
        <td class="dcs">${e ? `${ACT[e.act]}${e.reason ? `<br><span class="note">${e.reason}</span>` : ""}` : `<span class="note">нет записи</span>`}</td></tr>`; }).join("")}
      </tbody></table>` : `<p class="sub">В этот день Такт не предлагал менять график.</p>`}
      <p class="note" style="margin-top:18px">Записи появляются, когда на «Пульте» нажимают «Принять», «Отложить» или «Не нужно». ${logged.length ? "" : "Пока записей нет."}</p>`;
  }
  await draw();
}
