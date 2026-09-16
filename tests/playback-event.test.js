const assert = require('node:assert/strict')
const { test } = require('node:test')

test('playback events use valid IDs and count only active listening time', async () => {
  const {
    createPlaybackEvent,
    createPlaybackEventSession,
    createPlaybackUuid,
  } = await import('../src/services/playback-event.ts')
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const session = createPlaybackEventSession('audio-1', 1_000)

  const started = createPlaybackEvent(session, {
    eventType: 'started',
    positionSeconds: 10,
    durationSeconds: 100,
    playbackRate: 1,
    now: 1_000,
  })
  const progress = createPlaybackEvent(session, {
    eventType: 'progress',
    positionSeconds: 15,
    durationSeconds: 100,
    playbackRate: 1,
    now: 6_000,
  })
  const paused = createPlaybackEvent(session, {
    eventType: 'paused',
    positionSeconds: 18,
    durationSeconds: 100,
    playbackRate: 1,
    now: 9_000,
  })
  const resumed = createPlaybackEvent(session, {
    eventType: 'started',
    positionSeconds: 18,
    durationSeconds: 100,
    playbackRate: 1,
    now: 12_000,
  })

  assert.match(createPlaybackUuid(), uuidPattern)
  assert.match(started.eventId, uuidPattern)
  assert.match(started.playbackSessionId, uuidPattern)
  assert.equal(started.listenedMs, 0)
  assert.equal(progress.listenedMs, 5_000)
  assert.equal(paused.listenedMs, 3_000)
  assert.equal(resumed.listenedMs, 0)
  assert.equal(resumed.playbackSessionId, started.playbackSessionId)
})

test('playback events clamp positions to the reported duration', async () => {
  const { createPlaybackEvent, createPlaybackEventSession } = await import(
    '../src/services/playback-event.ts'
  )
  const session = createPlaybackEventSession('audio-1', 0)
  const event = createPlaybackEvent(session, {
    eventType: 'completed',
    positionSeconds: 101.25,
    durationSeconds: 100.5,
    playbackRate: 9,
    now: 1_000,
  })

  assert.equal(event.positionMs, 100_500)
  assert.equal(event.durationMs, 100_500)
  assert.equal(event.playbackRate, 4)

  const invalidRateEvent = createPlaybackEvent(session, {
    eventType: 'progress',
    positionSeconds: 1,
    durationSeconds: 100,
    playbackRate: Number.NaN,
    now: 2_000,
  })
  assert.equal(invalidRateEvent.playbackRate, 1)
})
