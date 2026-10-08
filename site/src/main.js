import "./style.css";

const TABS = {
  pult: () => import("./tabs/pult.js"),
  plan: () => import("./tabs/plan.js"),
  forecast: () => import("./tabs/forecast.js"),
  anomalies: () => import("./tabs/anomalies.js"),
  effect: () => import("./tabs/effect.js"),
  method: () => import("./tabs/method.js"),
};

const app = document.getElementById("app");
let cleanup = null, current = null;

async function route() {
  const [name, q] = (location.hash.slice(1) || "pult").split("?");
  const tab = TABS[name] ? name : "pult";
  if (tab === current && name === "pult" && cleanup) return;    // смена параметров внутри пульта
  current = tab;
  if (cleanup) { cleanup(); cleanup = null; }
  document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === `#${tab}`));
  app.innerHTML = `<div class="loading">Загрузка…</div>`;
  try {
    const mod = await TABS[tab]();
    cleanup = (await mod.render(app, new URLSearchParams(q || ""))) || null;
  } catch (e) {
    app.innerHTML = `<div class="loading">Не удалось загрузить данные: ${e.message}</div>`;
    console.error(e);
  }
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);

let resizeT;
addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { const c = current; current = null; if (cleanup) { cleanup(); cleanup = null; } route(); }, 250);
});

/* тема */
const root = document.documentElement;
try { const t = localStorage.getItem("takt-theme"); if (t) root.dataset.theme = t; } catch (e) {}
document.getElementById("theme").onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("takt-theme", root.dataset.theme); } catch (e) {}
  current = null; route();
};

route();
