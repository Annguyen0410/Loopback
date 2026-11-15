/**
 * Loopback website — progressive enhancement only.
 *
 * The page is complete without JavaScript: every section, image and answer is
 * in the HTML. This file adds the two demonstrations (theme switching and the
 * floating bar states), the current-section marker in the navigation, and the
 * footer year. No dependencies, no tracking, no network requests.
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ------------------------------------------------------------ theme picker */
const THEME_COPY = {
  blue: "Blue — the default. A cool, quiet room.",
  purple: "Purple — for the ideas that arrive late.",
  pink: "Pink — soft edges, nothing urgent.",
  green: "Green — steady, like a checklist finishing itself.",
  orange: "Orange — warm, awake, a little loud.",
  red: "Red — for the notes you want to see first.",
  teal: "Teal — clear water over a clean desk.",
  gradient: "Gradient — indigo leaning into violet.",
  sunset: "Sunset — the last hour of a working day.",
  ocean: "Ocean — deep, cold, calm.",
  forest: "Forest — grounded, mossy, out of the way.",
  candy: "Candy — the playful one.",
  mono: "Mono — no colour, no distraction.",
  galaxy: "Galaxy — deep violet, like a night sky.",
  aurora: "Aurora — an animated teal-to-green wallpaper.",
  coffee: "Coffee — paper, ink and a warm brown."
};

const shell = document.querySelector("[data-theme-shell]");
const themeShot = document.getElementById("themeShot");
const themeCaption = document.getElementById("themeCaption");
const swatches = [...document.querySelectorAll("[data-theme-option]")];

const themeName = (value) => {
  const label = swatches.find((s) => s.dataset.themeOption === value);
  return label ? label.querySelector(".name").textContent.trim() : value;
};

function paintTheme(value) {
  shell.dataset.themeShell = value;
  themeShot.src = `assets/shots/themes/${value}.jpg`;
  themeShot.alt = `Loopback's chat window in the ${themeName(value)} theme.`;
  themeCaption.textContent = THEME_COPY[value] || themeName(value);
}

let preloaded = new Set();
function preloadNearby(value) {
  const index = swatches.findIndex((s) => s.dataset.themeOption === value);
  const run = () => {
    for (const offset of [1, -1, 2]) {
      const next = swatches[(index + offset + swatches.length) % swatches.length];
      const key = next.dataset.themeOption;
      if (preloaded.has(key)) continue;
      preloaded.add(key);
      const img = new Image();
      img.decoding = "async";
      img.src = `assets/shots/themes/${key}.jpg`;
    }
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 200);
}

if (shell && themeShot && themeCaption) {
  swatches.forEach((label) => {
    const input = label.querySelector("input");
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const value = input.value;
      /* View Transitions are Baseline; where they are missing the image simply
         swaps, which is still correct. */
      if (document.startViewTransition && !reduceMotion.matches) {
        document.startViewTransition(() => paintTheme(value));
      } else {
        paintTheme(value);
      }
      preloadNearby(value);
    });
    label.addEventListener("pointerenter", () => preloadNearby(input.value));
  });
  preloadNearby("blue");
}

/* ------------------------------------------------------- floating bar demo */
const barDemo = document.querySelector("[data-bar-demo]");
if (barDemo) {
  const buttons = [...barDemo.querySelectorAll("[data-bar-state]")];
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const state = button.dataset.barState;
      barDemo.dataset.state = state;
      buttons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    });
  });
}

/* ------------------------------------------------- navigation current state */
const navLinks = [...document.querySelectorAll(".site-nav a, .menu-panel a")];
const sections = [...document.querySelectorAll("main section[id]")];

if (sections.length && "IntersectionObserver" in window) {
  const byId = new Map();
  navLinks.forEach((link) => {
    const id = link.getAttribute("href").slice(1);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(link);
  });
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target.id);
      else visible.delete(entry.target.id);
    }
    const current = sections.map((s) => s.id).find((id) => visible.has(id));
    navLinks.forEach((link) => {
      const id = link.getAttribute("href").slice(1);
      if (id === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-40% 0px -50% 0px" });
  sections.forEach((section) => observer.observe(section));
}

/* ------------------------------------------------------------- mobile menu */
const menu = document.getElementById("site-menu");
if (menu) {
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a") && typeof menu.hidePopover === "function") menu.hidePopover();
  });
}

/* ---------------------------------------------------------------- footer */
const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());
