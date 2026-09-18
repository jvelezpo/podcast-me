const assert = require('node:assert/strict')
const { test } = require('node:test')

async function load() {
  return import('../src/services/remote-audio-metadata.ts')
}

test('maps explicit local fields, including the artwork URL', async () => {
  const { buildRemoteMetadataUpdate } = await load()

  assert.deepEqual(
    buildRemoteMetadataUpdate({
      title: '  My Title  ',
      artist: 'Host',
      album: null,
      releaseYear: '2026',
      coverArtUrl: 'https://example.com/cover.jpg',
      description: 'Notes',
    }),
    {
      title: 'My Title',
      artist: 'Host',
      releaseYear: '2026',
      coverArtUrl: 'https://example.com/cover.jpg',
      description: 'Notes',
    },
  )
})

test('drops blank fields so server file tags are preserved', async () => {
  const { buildRemoteMetadataUpdate } = await load()

  assert.equal(
    buildRemoteMetadataUpdate({
      title: null,
      artist: '',
      album: '   ',
      releaseYear: null,
      coverArtUrl: null,
      description: undefined,
    }),
    null,
  )
})

test('rejects malformed years and non-http artwork URLs', async () => {
  const { buildRemoteMetadataUpdate } = await load()

  assert.deepEqual(
    buildRemoteMetadataUpdate({
      title: null,
      artist: null,
      album: null,
      releaseYear: '26',
      coverArtUrl: 'not a url',
      description: null,
    }),
    null,
  )

  assert.deepEqual(
    buildRemoteMetadataUpdate({
      title: null,
      artist: null,
      album: null,
      releaseYear: '1999',
      coverArtUrl: 'http://example.com/cover.png',
      description: null,
    }),
    { releaseYear: '1999', coverArtUrl: 'http://example.com/cover.png' },
  )
})
