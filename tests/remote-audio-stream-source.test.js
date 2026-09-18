const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')

const originalApiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN

afterEach(() => {
  if (originalApiOrigin === undefined) {
    delete process.env.EXPO_PUBLIC_API_ORIGIN
  } else {
    process.env.EXPO_PUBLIC_API_ORIGIN = originalApiOrigin
  }
})

test('attaches the Bearer token to same-origin proxy URLs', async () => {
  const { buildRemoteAudioStreamSource } = await import(
    '../src/services/api.ts'
  )

  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com'

  const relative = buildRemoteAudioStreamSource(
    '/api/v1/audios/audio-1/stream',
    'access-token',
  )
  assert.equal(
    relative.uri,
    'https://api.example.com/api/v1/audios/audio-1/stream',
  )
  assert.deepEqual(relative.headers, {
    Authorization: 'Bearer access-token',
  })

  const absolute = buildRemoteAudioStreamSource(
    'https://api.example.com/api/v1/audios/audio-1/stream',
    'access-token',
  )
  assert.deepEqual(absolute.headers, {
    Authorization: 'Bearer access-token',
  })
})

test('leaves presigned cross-origin URLs without an Authorization header', async () => {
  const { buildRemoteAudioStreamSource } = await import(
    '../src/services/api.ts'
  )

  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://api.example.com'
  const presigned =
    'https://account.r2.cloudflarestorage.com/podcasts/audio-1.mp3' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123'

  const source = buildRemoteAudioStreamSource(presigned, 'access-token')

  assert.equal(source.uri, presigned)
  assert.deepEqual(source.headers, {})
})

test('rejects invalid stream addresses', async () => {
  const { ApiError, buildRemoteAudioStreamSource } = await import(
    '../src/services/api.ts'
  )

  delete process.env.EXPO_PUBLIC_API_ORIGIN
  assert.throws(
    () => buildRemoteAudioStreamSource('/api/v1/audios/audio-1/stream', 't'),
    ApiError,
  )
})
