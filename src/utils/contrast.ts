/**
 * WCAG contrast math for auditing theme tokens. Pure logic (hex in, ratio
 * out) so it stays unit testable under plain `node --test`.
 */

export const MIN_CONTRAST_AA = 4.5

export function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/../g)
    ?.map((part) => {
      const channel = parseInt(part, 16) / 255
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4)
    })

  if (!channels || channels.length < 3) {
    return 0
  }

  const [red, green, blue] = channels
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [foreground, background]
    .map(relativeLuminance)
    .sort((first, second) => second - first)

  return (lighter + 0.05) / (darker + 0.05)
}
