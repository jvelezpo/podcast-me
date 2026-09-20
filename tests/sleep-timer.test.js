const assert = require('node:assert/strict')
const { test } = require('node:test')

test('formats sleep timer remaining time', async () => {
  const { formatSleepTimerRemaining } = await import(
    '../src/hooks/use-sleep-timer.ts'
  )

  assert.equal(formatSleepTimerRemaining(5 * 60_000), '5m left')
  assert.equal(formatSleepTimerRemaining(90_000), '2m left')
  assert.equal(formatSleepTimerRemaining(0), '1m left')
  assert.equal(formatSleepTimerRemaining(61 * 60_000), '1h left')
  assert.equal(formatSleepTimerRemaining(2 * 60 * 60_000), '2h left')
})
