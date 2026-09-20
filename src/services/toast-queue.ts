/**
 * Centralized toast queue replacing the ad-hoc per-screen `toastMessage`
 * state. Any layer (screens, context interruption handling) can notify; a
 * single `ToastCenter` renders the queue. Pure logic (no UI imports) so it
 * stays unit testable under plain `node --test`.
 */

export type ToastAction = {
  label: string
  accessibilityLabel?: string
  accessibilityHint?: string
  onPress: () => void
}

export type ToastItem = {
  id: number
  message: string
  action?: ToastAction
}

/** Maximum stacked toasts; beyond this the oldest is dropped silently. */
const MAX_QUEUE_DEPTH = 3

type ToastListener = () => void

let nextToastId = 1
let queue: ToastItem[] = []
const listeners = new Set<ToastListener>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

export function notifyToast(message: string, action?: ToastAction): number {
  const id = nextToastId
  nextToastId += 1
  queue = [...queue, { id, message, action }].slice(-MAX_QUEUE_DEPTH)
  emit()
  return id
}

export function dismissToast(id: number): void {
  if (!queue.some((toast) => toast.id === id)) {
    return
  }

  queue = queue.filter((toast) => toast.id !== id)
  emit()
}

export function getToastQueue(): ToastItem[] {
  return queue
}

export function clearToastQueue(): void {
  if (queue.length === 0) {
    return
  }

  queue = []
  emit()
}

export function subscribeToastQueue(listener: ToastListener): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
