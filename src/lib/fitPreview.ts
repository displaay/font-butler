export function fitPreviewScale(
  inkWidth: number,
  inkHeight: number,
  boxWidth: number,
  boxHeight: number,
  paddingRatio = 0.08,
): number {
  if (!(inkWidth > 0 && inkHeight > 0 && boxWidth > 0 && boxHeight > 0)) return 1
  const pad = Math.min(boxWidth, boxHeight) * paddingRatio
  const availW = Math.max(1, boxWidth - pad * 2)
  const availH = Math.max(1, boxHeight - pad * 2)
  return Math.min(1, availW / inkWidth, availH / inkHeight)
}

export function fitPreviewTransform(
  ink: { left: number; top: number; width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
  element: { left: number; top: number },
  paddingRatio = 0.08,
): { scale: number; translateX: number; translateY: number; originX: number; originY: number } {
  const scale = fitPreviewScale(ink.width, ink.height, box.width, box.height, paddingRatio)
  const inkCx = ink.left + ink.width / 2
  const inkCy = ink.top + ink.height / 2
  return {
    scale,
    translateX: box.left + box.width / 2 - inkCx,
    translateY: box.top + box.height / 2 - inkCy,
    originX: inkCx - element.left,
    originY: inkCy - element.top,
  }
}
