import "./style.css";
import { resetPalette } from "./lib/util.js";

const TABS = {
  pult: () => import("./tabs/pult.js"),
  plan: () => import("./tabs/plan.js"),
  anomalies: () => import("./tabs/anomalies.js"),
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
  const on = document.querySelector("#tabs a.on");
  if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
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
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { resetPalette(); current = null; route(); });

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
  resetPalette(); current = null; route();
};

route();
