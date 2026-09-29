/**
 * Voice message recording via MediaRecorder.
 */

import { $ } from "./dom.js";
import { toast } from "./toast.js";
import { addMessage } from "./messages.js";

let mediaRecorder = null;
let audioChunks = [];
let recordingStart = 0;
let recordingTimer = null;
let isRecording = false;
let cancelled = false;
let recTimeEl = null;

function buildRecordingBar() {
  const composer = $("composer");
  if (!composer) return;
  if (composer.querySelector(".recording-bar")) return;
  const recBar = document.createElement("div");
  recBar.className = "recording-bar";
  recBar.innerHTML = '<div class="recording-dot"></div><span class="recording-time">00:00</span><span class="recording-cancel">Cancel</span>';
  composer.append(recBar);
  recTimeEl = recBar.querySelector(".recording-time");
  recBar.querySelector(".recording-cancel").addEventListener("click", () => { cancelRec(); });
}

function updateRecTime() {
  if (!isRecording) return;
  const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
  if (recTimeEl) {
    recTimeEl.textContent =
      String(Math.floor(elapsed / 60)).padStart(2, "0") + ":" +
      String(elapsed % 60).padStart(2, "0");
  }
  recordingTimer = requestAnimationFrame(updateRecTime);
}

function stopRec() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  isRecording = false;
  cancelAnimationFrame(recordingTimer);
  const composer = $("composer");
  if (composer) composer.classList.remove("recording");
}

/* User pressed Cancel: stop the recorder but discard the audio. */
function cancelRec() {
  cancelled = true;
  stopRec();
  audioChunks = [];
  toast("Cancelled");
}

/* Pick a MediaRecorder mimeType this Chromium actually supports. */
function pickMime() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
  return candidates.find(c => !c || MediaRecorder.isTypeSupported(c)) || "";
}

export function initVoice() {
  buildRecordingBar();
  const btnVoice = $("btnVoice");
  if (!btnVoice) return;
  btnVoice.addEventListener("click", async () => {
    if (isRecording) { stopRec(); return; }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast("Microphone not available");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (cancelled) { cancelled = false; return; }
        const blob = new Blob(audioChunks, { type: mime || "audio/webm" });
        if (blob.size < 1000) { toast("Recording too short"); return; }
        const reader = new FileReader();
        reader.onloadend = async () => {
          if (!window.api.saveVoice) { toast("Voice saving unavailable"); return; }
          const file = await window.api.saveVoice(reader.result);
          if (file) await addMessage("", [file]);
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
      isRecording = true;
      recordingStart = Date.now();
      $("composer").classList.add("recording");
      updateRecTime();
    } catch {
      toast("Microphone access denied");
    }
  });
}
