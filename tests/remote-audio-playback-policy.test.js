const assert = require('node:assert/strict')
const { test } = require('node:test')

test('episodes retain their remote playback position', async () => {
  const { shouldTrackRemoteAudioPosition } = await import(
    '../src/services/remote-audio-playback-policy.ts'
  )

  assert.equal(shouldTrackRemoteAudioPosition({ type: 'episode' }), true)
})

test('tracks and unknown metadata always start from the beginning', async () => {
  const { shouldTrackRemoteAudioPosition } = await import(
    '../src/services/remote-audio-playback-policy.ts'
  )

  assert.equal(shouldTrackRemoteAudioPosition({ type: 'track' }), false)
  assert.equal(shouldTrackRemoteAudioPosition({}), false)
  assert.equal(shouldTrackRemoteAudioPosition(null), false)
})
