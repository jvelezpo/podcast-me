const assert = require('node:assert/strict')
const { test } = require('node:test')

test('scores black on white at 21:1 and identical colors at 1:1', async () => {
  const { contrastRatio } = await import('../src/utils/contrast.ts')

  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21)
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1)
})

test('is order independent', async () => {
  const { contrastRatio } = await import('../src/utils/contrast.ts')

  assert.equal(
    contrastRatio('#667085', '#FFFFFF'),
    contrastRatio('#FFFFFF', '#667085'),
  )
})

test('light colorMuted meets AA on every surface it sits on', async () => {
  const { MIN_CONTRAST_AA, contrastRatio } = await import(
    '../src/utils/contrast.ts'
  )

  // Audited pairs for the light `colorMuted` token: plain, app background,
  // selected cards, and the accent-subtle sleep/speed surfaces.
  const lightPairs = [
    ['#5D6779', '#FFFFFF'],
    ['#5D6779', '#F6F7FB'],
    ['#5D6779', '#ECEFF5'],
    ['#5D6779', '#ECEAFF'],
  ]

  for (const [foreground, background] of lightPairs) {
    assert.ok(
      contrastRatio(foreground, background) >= MIN_CONTRAST_AA,
      `${foreground} on ${background} is below AA`,
    )
  }
})

test('dark colorMuted meets AA on every surface it sits on', async () => {
  const { MIN_CONTRAST_AA, contrastRatio } = await import(
    '../src/utils/contrast.ts'
  )

  const darkPairs = [
    ['#9AA3B2', '#090B10'],
    ['#9AA3B2', '#14171F'],
    ['#9AA3B2', '#1D212C'],
    ['#9AA3B2', '#252044'],
  ]

  for (const [foreground, background] of darkPairs) {
    assert.ok(
      contrastRatio(foreground, background) >= MIN_CONTRAST_AA,
      `${foreground} on ${background} is below AA`,
    )
  }
})
