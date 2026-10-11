export type VariationPreviewFace = {
  family: string
  italic?: boolean
  /** OpenType width class of the face or named instance, when the hover cut has one. */
  widthClass?: string
  variation?: string
}

/** Faces that share the resting preview's family, width class, and italic cut. */
export function facesMatchingRestCut<T extends VariationPreviewFace>(
  faces: readonly T[],
  rest: VariationPreviewFace,
): T[] {
  const italic = Boolean(rest.italic)
  return faces.filter((face) => {
    if (face.family !== rest.family || Boolean(face.italic) !== italic) return false
    if (rest.widthClass !== undefined && face.widthClass !== rest.widthClass) return false
    return true
  })
}

/** True when hover cycling can morph axes instead of cross-fading static instances. */
export function facesSupportVariationInterpolation(faces: VariationPreviewFace[]): boolean {
  if (faces.length < 2) return false
  const first = faces[0]
  if (!first) return false
  const { family, italic = false } = first
  const variations: string[] = []
  for (const face of faces) {
    if (face.family !== family || Boolean(face.italic) !== Boolean(italic) || face.widthClass !== first.widthClass) {
      return false
    }
    if (!face.variation) return false
    variations.push(face.variation)
  }
  return new Set(variations).size >= 2
}
