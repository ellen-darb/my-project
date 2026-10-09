/* Журнал решений диспетчера. Хранится только в этом браузере (localStorage), без сервера.
   Запись: слот -> {act: accept | reject | snooze, reason?, m: [тексты мер], at}. Принятое и отклонённое меняет расчёт дня. */
const KEY = "takt-journal-v2";
let mem = null;

function read() {
  if (mem) return mem;
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); mem = v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (e) { mem = {}; }
  return mem;
}
function write() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* без хранилища журнал живёт до перезагрузки */ } }

export const REASONS = ["Поток скоро спадёт", "Нет свободных машинистов", "Выбрана другая мера", "Не согласен с прогнозом"];
export const ACT = { accept: "Принято", snooze: "Отложено", reject: "Не нужно" };

export const getDay = d => read()[d] || {};
export const getEntry = (d, t) => getDay(d)[t] || null;
export function setEntry(d, t, e) { const j = read(); (j[d] ||= {})[t] = { ...e, at: Date.now() }; write(); }
export function clearEntry(d, t) { const j = read(); if (j[d]) { delete j[d][t]; if (!Object.keys(j[d]).length) delete j[d]; write(); } }
export function clearDay(d) { const j = read(); delete j[d]; write(); }
export const daysWithEntries = () => Object.keys(read()).sort();
