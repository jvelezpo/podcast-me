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

test('moves to the previous audio in list order', async () => {
  const { findPreviousQueueEntry } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), remote('b', true), local('c')]
  assert.equal(
    findPreviousQueueEntry(entries, 'local', 'c', true)?.audio.id,
    'b',
  )
  assert.equal(
    findPreviousQueueEntry(entries, 'remote', 'b', true)?.item.id,
    'a',
  )
})

test('reorders queue entries by offset with clamping', async () => {
  const { reorderQueueEntries, getQueueEntryId } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), remote('b', true), local('c')]
  const ids = (list) => list.map(getQueueEntryId)
  assert.deepEqual(ids(reorderQueueEntries(entries, 'local', 'a', 2)), [
    'b',
    'c',
    'a',
  ])
  assert.deepEqual(ids(reorderQueueEntries(entries, 'local', 'c', -2)), [
    'c',
    'a',
    'b',
  ])
  // Clamps at the ends and leaves unknown ids alone.
  assert.deepEqual(ids(reorderQueueEntries(entries, 'local', 'a', -5)), [
    'a',
    'b',
    'c',
  ])
  assert.deepEqual(ids(reorderQueueEntries(entries, 'remote', 'x', 1)), [
    'a',
    'b',
    'c',
  ])
  assert.deepEqual(ids(reorderQueueEntries(entries, 'local', 'a', 0)), [
    'a',
    'b',
    'c',
  ])
})

test('removes queue entries by id', async () => {
  const { removeQueueEntry, getQueueEntryId } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), remote('b', true), local('c')]
  const remaining = removeQueueEntry(entries, 'remote', 'b')
  assert.deepEqual(remaining.map(getQueueEntryId), ['a', 'c'])
  // Unknown ids return an equal copy.
  assert.deepEqual(
    removeQueueEntry(entries, 'local', 'x').map(getQueueEntryId),
    ['a', 'b', 'c'],
  )
})

test('detects queue order changes', async () => {
  const { hasSameQueueOrder } = await import(
    '../src/services/playback-queue.ts'
  )

  assert.equal(
    hasSameQueueOrder([local('a'), local('b')], [local('a'), local('b')]),
    true,
  )
  assert.equal(
    hasSameQueueOrder([local('a'), local('b')], [local('b'), local('a')]),
    false,
  )
  assert.equal(hasSameQueueOrder([local('a')], [local('a'), local('b')]), false)
})

test('previous skips unplayable entries and stops at the start', async () => {
  const { findPreviousQueueEntry } = await import(
    '../src/services/playback-queue.ts'
  )

  const entries = [local('a'), local('b', false), local('c')]
  assert.equal(findPreviousQueueEntry(entries, 'local', 'c', true)?.item.id, 'a')

  const offline = [local('a'), remote('b'), remote('c', true)]
  const previous = findPreviousQueueEntry(offline, 'remote', 'c', false)
  assert.equal(previous?.kind, 'local')
  assert.equal(previous?.item.id, 'a')

  assert.equal(findPreviousQueueEntry(entries, 'local', 'a', true), null)
  assert.equal(findPreviousQueueEntry(entries, 'remote', 'missing', true), null)
})
