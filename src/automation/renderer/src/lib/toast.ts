export type ToastKind = 'info' | 'ok' | 'error'

export interface AppToast {
  id: string
  kind: ToastKind
  title: string
  body?: string
}

const MAX_TOASTS = 4
const TTL_MS = 6000

let toasts: AppToast[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Show an in-app toast for an action the user triggered (not a notification). */
export function pushToast(input: { kind?: ToastKind; title: string; body?: string }): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const toast: AppToast = {
    id,
    kind: input.kind ?? 'info',
    title: input.title,
    ...(input.body ? { body: input.body } : {})
  }
  toasts = [...toasts, toast].slice(-MAX_TOASTS)
  emit()
  window.setTimeout(() => dismissToast(id), TTL_MS)
  return id
}

export function dismissToast(id: string): void {
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function getAppToasts(): AppToast[] {
  return toasts
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
