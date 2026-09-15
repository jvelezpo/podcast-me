const assert = require('node:assert/strict')
const { test } = require('node:test')

const DAY_MS = 24 * 60 * 60 * 1_000

test('remote audio cache expires ten days after its last playback', async () => {
  const { isRemoteAudioCacheFresh } = await import(
    '../src/services/remote-audio-file-cache-policy.ts'
  )
  const lastPlayedAt = Date.parse('2026-09-01T12:00:00.000Z')

  assert.equal(isRemoteAudioCacheFresh(lastPlayedAt, lastPlayedAt + 10 * DAY_MS - 1), true)
  assert.equal(isRemoteAudioCacheFresh(lastPlayedAt, lastPlayedAt + 10 * DAY_MS), false)
})

test('playing cached remote audio refreshes its expiration window', async () => {
  const { isRemoteAudioCacheFresh } = await import(
    '../src/services/remote-audio-file-cache-policy.ts'
  )
  const firstPlayedAt = Date.parse('2026-09-01T12:00:00.000Z')
  const lastPlayedAt = firstPlayedAt + 9 * DAY_MS
  const now = firstPlayedAt + 11 * DAY_MS

  assert.equal(isRemoteAudioCacheFresh(firstPlayedAt, now), false)
  assert.equal(isRemoteAudioCacheFresh(lastPlayedAt, now), true)
})
