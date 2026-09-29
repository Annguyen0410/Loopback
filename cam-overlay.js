/**
 * Renderer for the floating camera bubble window (shown while recording from
 * the collapsed floating bar, which has no room for the in-app preview).
 *
 * Frames are pushed in from the recording window (it already has the camera),
 * the image is mirrored like a selfie view, and the window is excluded from
 * screen capture — so this bubble is only a control: wherever it sits on the
 * desktop is exactly where the camera lands in the video.
 */

const wrap = document.getElementById("wrap");
const frame = document.getElementById("frame");
const off = document.getElementById("off");
const sizeBtn = document.getElementById("size");

if (window.camApi) {
  window.camApi.onFrame(url => {
    if (typeof url === "string" && url) {
      if (off) off.hidden = true;
      if (frame.src !== url) frame.src = url;
    }
  });

  window.camApi.onSize(label => { if (sizeBtn) sizeBtn.textContent = label; });

  window.camApi.onState(state => {
    if (!off) return;
    off.hidden = state !== "off";
    if (state === "off" && frame) frame.removeAttribute("src");
  });
}

/* Same JS-driven drag as the chat bubble: frameless transparent windows can't
   use native window dragging. */
let drag = null;
let lastSend = 0;

wrap.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  if (e.target && e.target.closest && e.target.closest(".size")) return;
  e.preventDefault();
  drag = { sx: e.screenX, sy: e.screenY, base: null, id: e.pointerId, moved: false };
  wrap.classList.add("dragging");
  try { wrap.setPointerCapture(e.pointerId); } catch {}
  Promise.resolve(window.camApi.dragStart()).then(base => {
    if (drag && drag.id === e.pointerId && base) drag.base = base;
  }).catch(() => {});
});

wrap.addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.id || !drag.base) return;
  const dx = e.screenX - drag.sx;
  const dy = e.screenY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  const now = performance.now();
  if (now - lastSend < 16) return;
  lastSend = now;
  window.camApi.dragTo({ x: drag.base.x + dx, y: drag.base.y + dy });
});

function endDrag(e) {
  if (!drag) return;
  const id = drag.id;
  const moved = drag.moved;
  drag = null;
  wrap.classList.remove("dragging");
  try { if (e && e.pointerId != null) wrap.releasePointerCapture(e.pointerId); } catch {}
  if (moved) window.camApi.dragEnd();
  void id;
}

wrap.addEventListener("pointerup", endDrag);
wrap.addEventListener("pointercancel", endDrag);

if (sizeBtn) {
  sizeBtn.addEventListener("click", e => {
    e.stopPropagation();
    window.camApi.cycleSize();
  });
}
