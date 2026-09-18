const assert = require('node:assert/strict')
const { test } = require('node:test')

async function load() {
  return import('../src/services/audio-reconciliation.ts')
}

test('marks linked items uploaded and hides their remote duplicate', async () => {
  const { reconcileLibraryAudio } = await load()

  const result = reconcileLibraryAudio(
    [{ id: 'local-1', remoteAudioId: 'remote-1', isAvailable: true }],
    [{ id: 'remote-1' }, { id: 'remote-2' }],
    true,
  )

  assert.ok(result.uploadedLocalIds.has('local-1'))
  assert.ok(result.hiddenRemoteIds.has('remote-1'))
  assert.ok(!result.hiddenRemoteIds.has('remote-2'))
})

test('unlinked local items stay uploadable and remotes stay visible', async () => {
  const { reconcileLibraryAudio } = await load()

  const result = reconcileLibraryAudio(
    [{ id: 'local-1', remoteAudioId: null, isAvailable: true }],
    [{ id: 'remote-1' }],
    true,
  )

  assert.equal(result.uploadedLocalIds.size, 0)
  assert.equal(result.hiddenRemoteIds.size, 0)
})

test('a cloud copy deleted while online becomes uploadable again', async () => {
  const { reconcileLibraryAudio } = await load()

  const result = reconcileLibraryAudio(
    [{ id: 'local-1', remoteAudioId: 'remote-gone', isAvailable: true }],
    [{ id: 'remote-2' }],
    true,
  )

  assert.equal(result.uploadedLocalIds.size, 0)
  assert.equal(result.hiddenRemoteIds.size, 0)
})

test('an unverifiable link stays uploaded while offline', async () => {
  const { reconcileLibraryAudio } = await load()

  const result = reconcileLibraryAudio(
    [{ id: 'local-1', remoteAudioId: 'remote-1', isAvailable: true }],
    [],
    false,
  )

  assert.ok(result.uploadedLocalIds.has('local-1'))
  assert.equal(result.hiddenRemoteIds.size, 0)
})

test('a missing local copy does not hide its remote entry', async () => {
  const { reconcileLibraryAudio } = await load()

  const result = reconcileLibraryAudio(
    [{ id: 'local-1', remoteAudioId: 'remote-1', isAvailable: false }],
    [{ id: 'remote-1' }],
    true,
  )

  assert.ok(result.uploadedLocalIds.has('local-1'))
  assert.equal(result.hiddenRemoteIds.size, 0)
})

test('a null cloud list hides nothing', async () => {
  const { reconcileLibraryAudio } = await load()

  const result = reconcileLibraryAudio(
    [{ id: 'local-1', remoteAudioId: 'remote-1', isAvailable: true }],
    null,
    true,
  )

  assert.equal(result.uploadedLocalIds.size, 0)
  assert.equal(result.hiddenRemoteIds.size, 0)
})
