const assert = require('node:assert/strict')
const { test } = require('node:test')

function local(id, isAvailable = true) {
  return { kind: 'local', item: { id, isAvailable } }
}

function remote(id, isCached = false) {
  return { kind: 'remote', audio: { id }, isCached }
}

test('advances to the next audio in list order', async () => {
  const { findNextQueueEntry } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), remote('b', true), local('c')]
  assert.equal(findNextQueueEntry(entries, 'local', 'a', true)?.kind, 'remote')
  assert.equal(
    findNextQueueEntry(entries, 'remote', 'b', true)?.item.id,
    'c',
  )
})

test('skips unavailable local entries', async () => {
  const { findNextQueueEntry } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), local('b', false), local('c')]
  assert.equal(findNextQueueEntry(entries, 'local', 'a', true)?.item.id, 'c')
})

test('skips remote entries without connectivity unless downloaded', async () => {
  const { findNextQueueEntry } = await import(
    '../src/services/playback-queue.ts'
  )

  const online = [local('a'), remote('b'), local('c')]
  assert.equal(findNextQueueEntry(online, 'local', 'a', true)?.audio.id, 'b')

  const offline = [local('a'), remote('b'), remote('c', true)]
  const next = findNextQueueEntry(offline, 'local', 'a', false)
  assert.equal(next?.kind, 'remote')
  assert.equal(next?.audio.id, 'c')
})

test('stops at the end of the list without wrapping', async () => {
  const { findNextQueueEntry } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), remote('b', true)]
  assert.equal(findNextQueueEntry(entries, 'remote', 'b', true), null)
  assert.equal(findNextQueueEntry(entries, 'local', 'missing', true), null)
})
