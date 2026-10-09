/* Журнал решений диспетчера. Хранится только в этом браузере (localStorage), без сервера. */
const KEY = "takt-journal-v1";
let mem = null;

function read() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { mem = {}; }
  return mem;
}
function write() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* без хранилища журнал живёт до перезагрузки */ } }

export const REASONS = ["Поток скоро спадёт", "Нет свободных машинистов", "Выбрана другая мера", "Не согласен с прогнозом"];
export const ACT = { accept: "Принято", defer: "Отложено", reject: "Не нужно" };

export const getDay = d => read()[d] || {};
export const getEntry = (d, t) => getDay(d)[t] || null;
export function setEntry(d, t, e) { const j = read(); (j[d] ||= {})[t] = { ...e, at: Date.now() }; write(); }
export function clearEntry(d, t) { const j = read(); if (j[d]) { delete j[d][t]; if (!Object.keys(j[d]).length) delete j[d]; write(); } }
export const daysWithEntries = () => Object.keys(read()).sort();
