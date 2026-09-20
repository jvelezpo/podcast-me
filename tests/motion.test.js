const assert = require('node:assert/strict')
const { test } = require('node:test')

test('passes durations through when motion is allowed', async () => {
  const { resolveAnimationDuration } = await import(
    '../src/services/motion.ts'
  )

  assert.equal(resolveAnimationDuration(260, false), 260)
  assert.equal(resolveAnimationDuration(0, false), 0)
})

test('resolves to instant when motion is reduced', async () => {
  const { INSTANT_ANIMATION_MS, resolveAnimationDuration } = await import(
    '../src/services/motion.ts'
  )

  assert.equal(INSTANT_ANIMATION_MS, 0)
  assert.equal(resolveAnimationDuration(260, true), 0)
  assert.equal(resolveAnimationDuration(900, true), 0)
})
