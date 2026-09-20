const assert = require('node:assert/strict')
const { test } = require('node:test')

function remoteAudio(overrides = {}) {
  return {
    id: 'audio-1',
    title: 'Gym audiobook',
    source: 'episode.mp3',
    spotifyId: null,
    metadata: {
      coverArtUrl: 'https://cdn.example.com/cover.jpg',
      durationMs: 60_000,
    },
    createdAt: '2026-09-09T12:00:00.000Z',
    streamUrl: '/api/v1/audios/audio-1/stream',
    ...overrides,
  }
}

test('pins the fresh network source for the car snapshot', async () => {
  const { buildAndroidAutoRemoteCatalogEntries } = await import(
    '../src/services/android-auto-remote-sync.ts'
  )

  const entries = buildAndroidAutoRemoteCatalogEntries([
    {
      audio: remoteAudio(),
      source: {
        uri: 'https://api.example.com/api/v1/audios/audio-1/stream',
        headers: { Authorization: 'Bearer fresh-token' },
      },
    },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'remote:audio-1')
  assert.equal(entries[0].originalName, 'Gym audiobook')
  assert.equal(
    entries[0].localUri,
    'https://api.example.com/api/v1/audios/audio-1/stream',
  )
  assert.deepEqual(entries[0].requestHeaders, {
    Authorization: 'Bearer fresh-token',
  })
  assert.equal(entries[0].durationSeconds, 60)
  assert.deepEqual(entries[0].metadata, {
    coverArtUrl: 'https://cdn.example.com/cover.jpg',
  })
  assert.equal(entries[0].lastPositionSeconds, 0)
  assert.equal(entries[0].isPlayed, false)
})

test('prefers cached file sources so car playback needs no credentials', async () => {
  const { buildAndroidAutoRemoteCatalogEntries } = await import(
    '../src/services/android-auto-remote-sync.ts'
  )

  const entries = buildAndroidAutoRemoteCatalogEntries([
    {
      audio: remoteAudio(),
      source: {
        uri: 'file:///data/user/0/com.podcastme.app/files/remote-audio-cache-v1/user-1/audio-1.mp3',
        headers: {},
      },
    },
  ])

  assert.ok(entries[0].localUri.startsWith('file:'))
  assert.deepEqual(entries[0].requestHeaders, {})
})

test('keeps presigned cross-origin URLs free of Authorization headers', async () => {
  const { buildAndroidAutoRemoteCatalogEntries } = await import(
    '../src/services/android-auto-remote-sync.ts'
  )
  const presigned =
    'https://account.r2.cloudflarestorage.com/podcasts/audio-1.mp3' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123'

  const entries = buildAndroidAutoRemoteCatalogEntries([
    { audio: remoteAudio({ streamUrl: presigned }), source: { uri: presigned, headers: {} } },
  ])

  assert.equal(entries[0].localUri, presigned)
  assert.deepEqual(entries[0].requestHeaders, {})
})

test('drops invalid cover art and non-positive durations', async () => {
  const {
    buildAndroidAutoRemoteCatalogEntries,
    getRemoteCoverArtUrl,
    getRemoteDurationSeconds,
  } = await import('../src/services/android-auto-remote-sync.ts')

  assert.equal(getRemoteCoverArtUrl({ coverArtUrl: 'not-a-url' }), null)
  assert.equal(getRemoteCoverArtUrl(null), null)
  assert.equal(getRemoteDurationSeconds({ durationMs: 0 }), null)
  assert.equal(getRemoteDurationSeconds(null), null)

  const entries = buildAndroidAutoRemoteCatalogEntries([
    {
      audio: remoteAudio({
        metadata: { coverArtUrl: 'ftp://cdn.example.com/cover.jpg', durationMs: -5 },
      }),
      source: { uri: 'https://api.example.com/stream', headers: {} },
    },
  ])

  assert.deepEqual(entries[0].metadata, { coverArtUrl: null })
  assert.equal(entries[0].durationSeconds, null)
})

test('round-trips remote media ids, rejecting non-remote and empty ids', async () => {
  const { toRemoteMediaId, parseRemoteMediaId } = await import(
    '../src/services/android-auto-remote-sync.ts'
  )

  assert.equal(toRemoteMediaId('audio-1'), 'remote:audio-1')
  assert.equal(parseRemoteMediaId('remote:audio-1'), 'audio-1')
  assert.equal(parseRemoteMediaId('audio-1'), null)
  assert.equal(parseRemoteMediaId(null), null)
  assert.equal(parseRemoteMediaId('remote:'), null)
  assert.equal(parseRemoteMediaId(''), null)
})

test('resolves car-started remote playback back to the full audio', async () => {
  const {
    registerRemoteAudiosForCar,
    getRegisteredRemoteAudio,
    clearRegisteredRemoteAudios,
    parseRemoteMediaId,
  } = await import('../src/services/android-auto-remote-sync.ts')

  clearRegisteredRemoteAudios()
  assert.equal(getRegisteredRemoteAudio('audio-1'), null)

  registerRemoteAudiosForCar([remoteAudio(), remoteAudio({ id: 'audio-2' })])

  const adopted = getRegisteredRemoteAudio(
    parseRemoteMediaId('remote:audio-2') ?? '',
  )
  assert.equal(adopted?.title, 'Gym audiobook')

  clearRegisteredRemoteAudios()
  assert.equal(getRegisteredRemoteAudio('audio-1'), null)
})

test('copies headers so later token rotations cannot mutate a pushed snapshot', async () => {
  const { buildAndroidAutoRemoteCatalogEntries } = await import(
    '../src/services/android-auto-remote-sync.ts'
  )
  const headers = { Authorization: 'Bearer token-at-sync-time' }

  const entries = buildAndroidAutoRemoteCatalogEntries([
    {
      audio: remoteAudio(),
      source: { uri: 'https://api.example.com/stream', headers },
    },
  ])

  headers.Authorization = 'Bearer rotated-token'
  assert.deepEqual(entries[0].requestHeaders, {
    Authorization: 'Bearer token-at-sync-time',
  })
})
