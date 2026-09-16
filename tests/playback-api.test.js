const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')

const originalFetch = globalThis.fetch
const originalApiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN

afterEach(() => {
  globalThis.fetch = originalFetch

  if (originalApiOrigin === undefined) {
    delete process.env.EXPO_PUBLIC_API_ORIGIN
  } else {
    process.env.EXPO_PUBLIC_API_ORIGIN = originalApiOrigin
  }
})

test('gets authenticated playback progress for an encoded audio ID', async () => {
  const { getPlaybackProgress } = await import('../src/services/api.ts')
  const playback = {
    audioId: 'audio/1',
    positionMs: 12_000,
    durationMs: 60_000,
    completed: false,
    playbackSessionId: '3d813cbb-47fb-42ba-91df-831e1593ac29',
    deviceId: null,
    updatedAt: '2026-09-15T12:00:00.000Z',
  }
  let request

  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com/'
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ playback }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  assert.deepEqual(await getPlaybackProgress('access-token', 'audio/1'), playback)
  assert.equal(
    request.url,
    'https://api.example.com/api/v1/audios/audio%2F1/playback',
  )
  assert.equal(request.options.headers.Authorization, 'Bearer access-token')
})

test('records playback events with PUT and JSON authentication', async () => {
  const { recordPlaybackEvent } = await import('../src/services/api.ts')
  const event = {
    eventId: '1abed758-2ac7-4d91-9d12-2738c67e7714',
    playbackSessionId: '3d813cbb-47fb-42ba-91df-831e1593ac29',
    eventType: 'progress',
    positionMs: 12_000,
    listenedMs: 5_000,
    occurredAt: '2026-09-15T12:00:00.000Z',
  }
  let request

  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com'
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(
      JSON.stringify({
        eventAccepted: true,
        playback: {
          audioId: 'audio-1',
          positionMs: 12_000,
          durationMs: null,
          completed: false,
          playbackSessionId: event.playbackSessionId,
          deviceId: null,
          updatedAt: event.occurredAt,
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    )
  }

  await recordPlaybackEvent('access-token', 'audio-1', event)

  assert.equal(request.options.method, 'PUT')
  assert.equal(request.options.headers.Authorization, 'Bearer access-token')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), event)
})
