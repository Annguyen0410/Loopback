/**
 * Base layers UI: dark / light / satellite switcher.
 */

import { setBase } from "./map-engine.js";

const BTN = [
  { id: "baseDark",  name: "dark"  },
  { id: "baseLight", name: "light" },
  { id: "baseSat",   name: "sat"   }
];

export function initBaseLayers() {
  for (const b of BTN) {
    const el = document.getElementById(b.id);
    if (!el) continue;
    el.addEventListener("click", () => {
      setBase(b.name);
      for (const x of BTN) document.getElementById(x.id).classList.toggle("active", x.id === b.id);
    });
  }
}
