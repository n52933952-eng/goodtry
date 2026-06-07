/** Host camera pip size steps (3:4 portrait). */
export const PIP_SIZE_STEPS = [
  { w: 72, h: 96 },
  { w: 96, h: 128 },
  { w: 128, h: 171 },
  { w: 168, h: 224 },
] as const;

export const PIP_DEFAULT_SIZE_INDEX = 1;

export function clampPipPosition(
  x: number,
  y: number,
  pipW: number,
  pipH: number,
  winW: number,
  winH: number,
  topInset = 0,
  bottomPad = 88,
) {
  const edge = 8;
  return {
    x: Math.min(Math.max(edge, x), winW - pipW - edge),
    y: Math.min(Math.max(topInset + edge, y), winH - pipH - bottomPad),
  };
}
