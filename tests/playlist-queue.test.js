const assert = require('node:assert/strict')
const { test } = require('node:test')

async function loadQueue() {
  return import('../src/services/playlist-queue.ts')
}

async function loadModel() {
  return import('../src/models/playlist.ts')
}

function localItem(id, isAvailable = true) {
  return { id, isAvailable }
}

function remoteAudio(id) {
  return { id }
}

test('resolves playlist order and skips missing entries', async () => {
  const { resolvePlaylistEntries } = await loadQueue()

  const playlist = {
    id: 'p1',
    name: 'Trip',
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      { kind: 'local', audioId: 'a' },
      { kind: 'local', audioId: 'gone' },
      { kind: 'remote', audioId: 'r1' },
      { kind: 'remote', audioId: 'gone-remote' },
    ],
  }

  const entries = resolvePlaylistEntries(
    playlist,
    [localItem('a'), localItem('b')],
    [remoteAudio('r1')],
    new Set(['r1'])
  )

  assert.equal(entries.length, 2)
  assert.equal(entries[0].kind, 'local')
  assert.equal(entries[0].item.id, 'a')
  assert.equal(entries[1].kind, 'remote')
  assert.equal(entries[1].audio.id, 'r1')
  assert.equal(entries[1].isCached, true)
})

test('playlist queue advances in playlist order, not library order', async () => {
  const { resolvePlaylistEntries } = await loadQueue()
  const { findNextQueueEntry } = await import('../src/services/playback-queue.ts')

  const playlist = {
    id: 'p1',
    name: 'Trip',
    description: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      { kind: 'local', audioId: 'c' },
      { kind: 'local', audioId: 'a' },
    ],
  }

  const entries = resolvePlaylistEntries(
    playlist,
    [localItem('a'), localItem('b'), localItem('c')],
    [],
    new Set()
  )

  assert.equal(entries[0].item.id, 'c')
  const next = findNextQueueEntry(entries, 'local', 'c', true)
  assert.equal(next?.item.id, 'a')
  assert.equal(findNextQueueEntry(entries, 'local', 'a', true), null)
})

test('playlist refs de-duplicate by kind and id', async () => {
  const { playlistRefKey, isPlaylistAudioRef } = await loadModel()

  assert.equal(playlistRefKey({ kind: 'local', audioId: 'a' }), 'local:a')
  assert.notEqual(
    playlistRefKey({ kind: 'remote', audioId: 'a' }),
    playlistRefKey({ kind: 'local', audioId: 'a' })
  )
  assert.ok(isPlaylistAudioRef({ kind: 'local', audioId: 'a' }))
  assert.ok(!isPlaylistAudioRef({ kind: 'local', audioId: '  ' }))
  assert.ok(!isPlaylistAudioRef({ kind: 'unknown', audioId: 'a' }))
})
