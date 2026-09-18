const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')

const requests = []
const originalFetch = globalThis.fetch

afterEach(() => {
  requests.length = 0
  globalThis.fetch = originalFetch
})

function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return handler(url, init)
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

test('createAudioUpload requests a grant without empty contentType', async () => {
  const { createAudioUpload } = await import('../src/services/api.ts')

  mockFetch(async (url) => {
    assert.ok(url.endsWith('/api/v1/audios/uploads'))
    return jsonResponse({
      upload: {
        uploadId: 'upload-1',
        uploadUrl: 'https://r2.example.com/upload-1?sig=abc',
        method: 'PUT',
        contentType: 'audio/mpeg',
        expiresIn: 600,
      },
    })
  })

  const grant = await createAudioUpload('access-token', {
    fileName: 'episode.mp3',
    size: 1024,
  })

  assert.equal(grant.uploadId, 'upload-1')
  assert.equal(grant.method, 'PUT')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].init.method, 'POST')
  assert.equal(
    requests[0].init.headers.Authorization,
    'Bearer access-token',
  )
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    fileName: 'episode.mp3',
    size: 1024,
  })
})

test('createAudioUpload forwards an explicit contentType', async () => {
  const { createAudioUpload } = await import('../src/services/api.ts')

  mockFetch(async () =>
    jsonResponse({
      upload: {
        uploadId: 'upload-2',
        uploadUrl: 'https://r2.example.com/upload-2?sig=def',
        method: 'PUT',
        contentType: 'audio/mp4',
        expiresIn: 600,
      },
    }),
  )

  await createAudioUpload('access-token', {
    fileName: 'memo.m4a',
    contentType: 'audio/mp4',
    size: 2048,
  })

  assert.deepEqual(JSON.parse(requests[0].init.body), {
    fileName: 'memo.m4a',
    contentType: 'audio/mp4',
    size: 2048,
  })
})

test('completeAudioUpload posts the same file details to the grant URL', async () => {
  const { completeAudioUpload } = await import('../src/services/api.ts')
  const audio = {
    id: 'audio-1',
    title: 'episode.mp3',
    source: 'episode.mp3',
    spotifyId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    streamUrl: '/api/v1/audios/audio-1/stream',
  }

  mockFetch(async (url) => {
    assert.ok(url.endsWith('/api/v1/audios/uploads/upload-1/complete'))
    return jsonResponse({ audio }, 201)
  })

  const result = await completeAudioUpload('access-token', 'upload-1', {
    fileName: 'episode.mp3',
    contentType: 'audio/mpeg',
    size: 1024,
  })

  assert.equal(result.audio.id, 'audio-1')
  assert.equal(requests[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    fileName: 'episode.mp3',
    contentType: 'audio/mpeg',
    size: 1024,
  })
})

test('updateAudioMetadata patches artwork and details by id', async () => {
  const { updateAudioMetadata } = await import('../src/services/api.ts')
  const audio = {
    id: 'audio-1',
    title: 'Patched title',
    source: 'episode.mp3',
    spotifyId: null,
    metadata: { coverArtUrl: 'https://example.com/cover.jpg' },
    createdAt: new Date().toISOString(),
    streamUrl: '/api/v1/audios/audio-1/stream',
  }

  mockFetch(async (url) => {
    assert.ok(url.endsWith('/api/v1/audios/audio-1'))
    return jsonResponse({ audio })
  })

  const result = await updateAudioMetadata('access-token', 'audio-1', {
    title: 'Patched title',
    coverArtUrl: 'https://example.com/cover.jpg',
  })

  assert.equal(result.audio.metadata.coverArtUrl, 'https://example.com/cover.jpg')
  assert.equal(requests[0].init.method, 'PATCH')
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    title: 'Patched title',
    coverArtUrl: 'https://example.com/cover.jpg',
  })
})
test('upload endpoints surface backend error messages', async () => {
  const { ApiError, createAudioUpload } = await import(
    '../src/services/api.ts'
  )

  mockFetch(async () =>
    jsonResponse({ error: { code: 'quota_exceeded', message: 'Daily limit.' } }, 403),
  )

  await assert.rejects(
    () =>
      createAudioUpload('access-token', {
        fileName: 'episode.mp3',
        size: 1024,
      }),
    (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 403)
      assert.equal(error.message, 'Daily limit.')
      return true
    },
  )
})
