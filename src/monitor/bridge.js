/** Bridge to the Electron preload (window.monitorApi). */

export const api = window.monitorApi || null;

export async function proxyFetch(url) {
  if (!api || !api.proxy) return { ok: false, error: "no-bridge" };
  return api.proxy(url);
}

/** Subscribe to main-process live pushes (monitor:live). */
export function onLive(cb) {
  if (api && api.onLive) api.onLive(cb);
}

export function closeMonitor() { if (api && api.close) api.close(); }
