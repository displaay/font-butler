export type VariationPreviewFace = {
  family: string
  italic?: boolean
  variation?: string
}

/** True when hover cycling can morph axes instead of cross-fading static instances. */
export function facesSupportVariationInterpolation(faces: VariationPreviewFace[]): boolean {
  if (faces.length < 2) return false
  const first = faces[0]
  if (!first) return false
  const { family, italic = false } = first
  const variations: string[] = []
  for (const face of faces) {
    if (face.family !== family || Boolean(face.italic) !== Boolean(italic)) return false
    if (!face.variation) return false
    variations.push(face.variation)
  }
  return new Set(variations).size >= 2
}
