const assert = require('node:assert/strict')
const { test } = require('node:test')

function item(id, lastPositionSeconds, isPlayed = false) {
  return { id, lastPositionSeconds, isPlayed }
}

test('returns null for an empty library', async () => {
  const { findResumeItem } = await import('../src/utils/resume.ts')
  assert.equal(findResumeItem([]), null)
})

test('returns null when nothing was started', async () => {
  const { findResumeItem } = await import('../src/utils/resume.ts')
  assert.equal(
    findResumeItem([item('a', 0), item('b', 0, true)]),
    null,
  )
})

test('picks the unfinished item with the greatest saved position', async () => {
  const { findResumeItem } = await import('../src/utils/resume.ts')
  const recent = item('recent', 120)
  const oldest = item('oldest', 3_400)
  assert.equal(
    findResumeItem([recent, oldest, item('fresh', 0)]),
    oldest,
  )
})

test('skips finished episodes even with a leftover position', async () => {
  const { findResumeItem } = await import('../src/utils/resume.ts')
  const finished = item('finished', 9_999, true)
  const current = item('current', 45)
  assert.equal(findResumeItem([finished, current]), current)
})

test('ignores non-positive positions', async () => {
  const { findResumeItem } = await import('../src/utils/resume.ts')
  assert.equal(
    findResumeItem([item('a', -5), item('b', 0)]),
    null,
  )
})

test('keeps the first item on a position tie', async () => {
  const { findResumeItem } = await import('../src/utils/resume.ts')
  const first = item('first', 60)
  const second = item('second', 60)
  assert.equal(findResumeItem([first, second]), first)
})
