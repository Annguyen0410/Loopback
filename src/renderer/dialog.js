/**
 * In-app modal dialogs replacing window.prompt / window.confirm,
 * which are NOT supported inside Electron (they throw or no-op).
 * Both return Promises: promptDialog → string|null, confirmDialog → boolean.
 */

let overlay = null;

function ensureOverlay() {
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.id = "dialogOverlay";
  document.body.append(overlay);
  return overlay;
}

function hideOverlay() {
  if (overlay) { overlay.hidden = true; overlay.innerHTML = ""; }
}

/** Ask for a single line of text. Resolves with the value or null on cancel. */
export function promptDialog({ title = "Enter a value", placeholder = "", value = "", okText = "OK" } = {}) {
  return new Promise(resolve => {
    const ov = ensureOverlay();
    ov.innerHTML =
      '<div class="dialog-card" role="dialog" aria-modal="true">' +
      '<div class="dialog-title"></div>' +
      '<div class="dialog-actions">' +
      '<button class="btn-secondary dialog-cancel" type="button">Cancel</button>' +
      '<button class="btn-primary dialog-ok" type="button"></button>' +
      "</div></div>";

    ov.querySelector(".dialog-title").textContent = title;
    const ok = ov.querySelector(".dialog-ok");
    ok.textContent = okText;

    const input = document.createElement("input");
    input.className = "dialog-input";
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value;
    ov.querySelector(".dialog-card").insertBefore(input, ov.querySelector(".dialog-actions"));
    ov.hidden = false;

    const done = val => { hideOverlay(); resolve(val); };
    ok.onclick = () => done(input.value);
    ov.querySelector(".dialog-cancel").onclick = () => done(null);
    input.onkeydown = e => {
      if (e.key === "Enter") { e.preventDefault(); ok.click(); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    };
    ov.onclick = e => { if (e.target === ov) done(null); };

    input.focus();
    input.select();
  });
}

/** Confirm a destructive/important action. Resolves true only when confirmed. */
export function confirmDialog({ title = "Are you sure?", message = "", okText = "Delete", danger = true } = {}) {
  return new Promise(resolve => {
    const ov = ensureOverlay();
    ov.innerHTML =
      '<div class="dialog-card" role="dialog" aria-modal="true">' +
      '<div class="dialog-title"></div>' +
      '<div class="dialog-message"></div>' +
      '<div class="dialog-actions">' +
      '<button class="btn-secondary dialog-cancel" type="button">Cancel</button>' +
      '<button class="dialog-ok" type="button"></button>' +
      "</div></div>";

    ov.querySelector(".dialog-title").textContent = title;
    ov.querySelector(".dialog-message").textContent = message;
    const ok = ov.querySelector(".dialog-ok");
    ok.textContent = okText;
    ok.className = danger ? "btn-danger dialog-ok" : "btn-primary dialog-ok";
    ov.hidden = false;

    const done = val => { hideOverlay(); resolve(val); };
    ok.onclick = () => done(true);
    ov.querySelector(".dialog-cancel").onclick = () => done(null);
    ov.onclick = e => { if (e.target === ov) done(null); };

    ok.focus();
  });
}
