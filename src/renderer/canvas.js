/**
 * Whiteboard / drawing canvas: pen, eraser, send as image.
 */

import { $ } from "./dom.js";
import { settings } from "./state.js";
import { addMessage } from "./messages.js";

let canvas = null;
let ctx = null;
let drawing = false;
let lastPt = null;
let currentTool = "pen";
let strokes = 0;

function bgColor() { return settings.darkMode ? "#242526" : "#fff"; }

export function openCanvas() {
  $("canvasPanel").classList.add("open");
  requestAnimationFrame(() => { resizeCanvas(); clearCanvas(); });
}

export function closeCanvas() { $("canvasPanel").classList.remove("open"); }

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const old = document.createElement("canvas");
  old.width = canvas.width; old.height = canvas.height;
  old.getContext("2d").drawImage(canvas, 0, 0);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bgColor();
  ctx.fillRect(0, 0, rect.width, rect.height);
  if (old.width) ctx.drawImage(old, 0, 0, old.width / dpr, old.height / dpr);
}

function clearCanvas() {
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = bgColor();
  ctx.fillRect(0, 0, rect.width, rect.height);
  strokes = 0;
  $("strokeCount").textContent = "0";
}

function getPt(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function stopDraw(e) {
  drawing = false;
  lastPt = null;
  ctx.globalCompositeOperation = "source-over";
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}

export function initCanvas() {
  canvas = $("canvasBoard");
  if (!canvas) return;
  ctx = canvas.getContext("2d");

  canvas.addEventListener("pointerdown", e => {
    drawing = true;
    lastPt = getPt(e);
    canvas.setPointerCapture(e.pointerId);
    strokes++;
    $("strokeCount").textContent = String(strokes);
  });
  canvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    const next = getPt(e);
    if (currentTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = Number($("sizeSlider").value) * 3;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = $("colorPicker").value;
      ctx.lineWidth = Number($("sizeSlider").value);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPt.x, lastPt.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastPt = next;
  });
  canvas.addEventListener("pointerup", stopDraw);
  canvas.addEventListener("pointercancel", stopDraw);
  canvas.addEventListener("pointerleave", e => { if (drawing) stopDraw(e); });

  $("sizeSlider").addEventListener("input", () => { $("sizeLabel").textContent = $("sizeSlider").value; });

  document.querySelectorAll("[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tool]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;
      $("toolName").textContent = currentTool === "pen" ? "Pen" : "Eraser";
    });
  });

  $("btnWhiteboard").addEventListener("click", openCanvas);
  $("btnCancelCanvas").addEventListener("click", closeCanvas);
  $("btnClearCanvas").addEventListener("click", clearCanvas);
  $("btnSendCanvas").addEventListener("click", async () => {
    const file = await window.api.saveCanvas(canvas.toDataURL("image/png"));
    if (file) await addMessage("", [file]);
    closeCanvas();
  });

  window.addEventListener("resize", () => {
    if ($("canvasPanel").classList.contains("open")) resizeCanvas();
  });
}
