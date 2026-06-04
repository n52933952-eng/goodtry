export function clampMiniBarPosition(
  x: number,
  y: number,
  barW: number,
  barH: number,
  winW: number,
  winH: number,
  topInset = 0,
  bottomInset = 100,
) {
  const edge = 8;
  return {
    x: Math.min(Math.max(edge, x), winW - barW - edge),
    y: Math.min(Math.max(topInset + edge, y), winH - barH - bottomInset),
  };
}
