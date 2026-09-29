/**
 * Sidebar tabs (RISK / ROUTE / SCEN / FIN / INFRA / CYBER) — lazy render on open.
 */

import { $ } from "./utils.js";
import { renderRiskTab } from "./country-risk.js";
import { renderFinanceTab } from "./finance.js";
import { renderInfraTab } from "./infrastructure.js";
import { renderScenarioTab } from "./scenarios.js";
import { renderRouteTab } from "./route-explorer.js";

const TABS = { intel: "sbIntel", risk: "sbRisk", route: "sbRoute", scenario: "sbScenario", finance: "sbFinance", infra: "sbInfra" };
let current = "intel";
let rendered = { intel: false, risk: false, route: false, scenario: false, finance: false, infra: false };
const renderers = {}; // tab → fn

export function registerTab(tabId, renderFn) { renderers[tabId] = renderFn; }

export function initSidebar() {
  registerTab("risk", renderRiskTab);
  registerTab("route", renderRouteTab);
  registerTab("scenario", renderScenarioTab);
  registerTab("finance", renderFinanceTab);
  registerTab("infra", renderInfraTab);
  const tabs = document.querySelectorAll(".sb-tab[data-tab]");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => activate(tab.getAttribute("data-tab")));
  });
  const collapseBtn = $("sbCollapse");
  if (collapseBtn) collapseBtn.addEventListener("click", () => {
    const sb = $("sidebar");
    sb.classList.toggle("collapsed");
    collapseBtn.innerHTML = sb.classList.contains("collapsed") ? "&#x25B6;" : "&#x25C0;";
    window.dispatchEvent(new Event("wm-sidebar-resize"));
  });
}

export function activate(tabId) {
  if (!TABS[tabId]) return;
  current = tabId;
  document.querySelectorAll(".sb-tab[data-tab]").forEach(t => t.classList.toggle("active", t.getAttribute("data-tab") === tabId));
  Object.entries(TABS).forEach(([k, domId]) => {
    const el = document.getElementById(domId);
    if (el) el.classList.toggle("active", k === tabId);
  });
  if (!rendered[tabId] && renderers[tabId]) { try { renderers[tabId](); rendered[tabId] = true; } catch (e) { console.warn("[Monitor] tab render", tabId, e); } }
}

export function currentTab() { return current; }
