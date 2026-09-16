export function paintedPreviewIndices(
  length: number,
  visibleIndex: number,
  cycling: boolean,
): number[] {
  if (length <= 0) return []
  const visible = Math.min(Math.max(0, visibleIndex), length - 1)
  if (!cycling || length < 2) return [visible]
  const previous = (visible + length - 1) % length
  const next = (visible + 1) % length
  return [...new Set([previous, visible, next])]
}
