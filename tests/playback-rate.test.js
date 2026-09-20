const assert = require('node:assert/strict')
const { test } = require('node:test')

test('clamps rates into the 0.5-3 range', async () => {
  const { clampPlaybackRate } = await import('../src/utils/playback-rate.ts')

  assert.equal(clampPlaybackRate(1.5), 1.5)
  assert.equal(clampPlaybackRate(0.5), 0.5)
  assert.equal(clampPlaybackRate(3), 3)
  assert.equal(clampPlaybackRate(0.25), 0.5)
  assert.equal(clampPlaybackRate(4), 3)
  assert.equal(clampPlaybackRate(NaN), 1)
  assert.equal(clampPlaybackRate(Infinity), 1)
})

test('exposes the full sheet option list up to 3x', async () => {
  const { PLAYBACK_RATE_OPTIONS } = await import(
    '../src/utils/playback-rate.ts'
  )

  assert.deepEqual([...PLAYBACK_RATE_OPTIONS], [
    0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
  ])
})

test('keys memory by artist and album', async () => {
  const { getShowKey } = await import('../src/utils/playback-rate.ts')

  assert.equal(
    getShowKey({ artist: 'My Show', album: 'Season 1' }),
    getShowKey({ artist: 'my show', album: 'season 1 ' }),
  )
  assert.notEqual(
    getShowKey({ artist: 'Show A' }),
    getShowKey({ artist: 'Show B' }),
  )
})

test('returns null without show information', async () => {
  const { getShowKey } = await import('../src/utils/playback-rate.ts')

  assert.equal(getShowKey(null), null)
  assert.equal(getShowKey(undefined), null)
  assert.equal(getShowKey({}), null)
  assert.equal(getShowKey({ artist: '  ', album: '' }), null)
})

test('treats artist-only and album-only as distinct shows', async () => {
  const { getShowKey } = await import('../src/utils/playback-rate.ts')

  assert.notEqual(getShowKey({ artist: 'Show' }), getShowKey({ album: 'Show' }))
  assert.equal(getShowKey({ artist: 'Show' }), getShowKey({ artist: 'Show' }))
})
