const assert = require('node:assert/strict')
const { test } = require('node:test')

test('queues toasts in FIFO order', async () => {
  const { clearToastQueue, getToastQueue, notifyToast } = await import(
    '../src/services/toast-queue.ts'
  )
  clearToastQueue()

  notifyToast('first')
  notifyToast('second')

  assert.deepEqual(
    getToastQueue().map((toast) => toast.message),
    ['first', 'second'],
  )
})

test('dismiss removes only the targeted toast', async () => {
  const { clearToastQueue, dismissToast, getToastQueue, notifyToast } = await import(
    '../src/services/toast-queue.ts'
  )
  clearToastQueue()

  const first = notifyToast('first')
  notifyToast('second')
  dismissToast(first)

  assert.deepEqual(
    getToastQueue().map((toast) => toast.message),
    ['second'],
  )
  dismissToast(999_999)
  assert.equal(getToastQueue().length, 1)
})

test('notifies subscribers and supports unsubscribe', async () => {
  const { clearToastQueue, notifyToast, subscribeToastQueue } = await import(
    '../src/services/toast-queue.ts'
  )
  clearToastQueue()

  let calls = 0
  const unsubscribe = subscribeToastQueue(() => {
    calls += 1
  })

  notifyToast('hello')
  assert.equal(calls, 1)
  unsubscribe()
  notifyToast('hello again')
  assert.equal(calls, 1)
})

test('caps the queue depth, dropping the oldest', async () => {
  const { clearToastQueue, getToastQueue, notifyToast } = await import(
    '../src/services/toast-queue.ts'
  )
  clearToastQueue()

  notifyToast('one')
  notifyToast('two')
  notifyToast('three')
  notifyToast('four')

  assert.deepEqual(
    getToastQueue().map((toast) => toast.message),
    ['two', 'three', 'four'],
  )
})

test('keeps the action on the queued toast', async () => {
  const { clearToastQueue, dismissToast, getToastQueue, notifyToast } = await import(
    '../src/services/toast-queue.ts'
  )
  clearToastQueue()

  let pressed = false
  const id = notifyToast('Paused for phone call', {
    label: 'Resume',
    onPress: () => {
      pressed = true
    },
  })

  getToastQueue().find((toast) => toast.id === id)?.action?.onPress()
  assert.equal(pressed, true)
  dismissToast(id)
})
