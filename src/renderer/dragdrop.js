/**
 * Drag and drop: files dropped onto the chat panel are stored via the
 * main process (webUtils path on the renderer side).
 */

import { $ } from "./dom.js";
import { toast } from "./toast.js";
import { addMessage } from "./messages.js";

export function initDragDrop() {
  const chatPanel = $("chatPanel");
  if (!chatPanel) return;
  const dropzone = $("dropzone");
  let dragCounter = 0;

  chatPanel.addEventListener("dragenter", e => { e.preventDefault(); dragCounter++; if (dropzone) dropzone.hidden = false; });
  chatPanel.addEventListener("dragleave", e => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; if (dropzone) dropzone.hidden = true; } });
  chatPanel.addEventListener("dragover", e => { e.preventDefault(); });

  chatPanel.addEventListener("drop", async e => {
    e.preventDefault();
    dragCounter = 0;
    if (dropzone) dropzone.hidden = true;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const stored = await window.api.storeDroppedFiles(files);
    if (stored && stored.length) {
      await addMessage("", stored);
    } else {
      toast("Could not save dropped files");
    }
  });
}
