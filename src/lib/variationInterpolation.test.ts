import assert from 'node:assert/strict'
import { test } from 'node:test'
import { facesSupportVariationInterpolation } from './variationInterpolation.ts'

function vfFace(label: string, variation: string) {
  return { family: 'Recoleta', italic: false, label, variation }
}

test('facesSupportVariationInterpolation requires matching VF variation strings', () => {
  assert.equal(
    facesSupportVariationInterpolation([
      vfFace('Light', "'wght' 300"),
      vfFace('Bold', "'wght' 700"),
    ]),
    true,
  )
  assert.equal(
    facesSupportVariationInterpolation([vfFace('Regular', "'wght' 400")]),
    false,
  )
  assert.equal(
    facesSupportVariationInterpolation([
      vfFace('Light', "'wght' 300"),
      vfFace('Light', "'wght' 300"),
    ]),
    false,
  )
  assert.equal(
    facesSupportVariationInterpolation([
      vfFace('Light', "'wght' 300"),
      { family: 'Other', italic: false, label: 'Bold', variation: "'wght' 700" },
    ]),
    false,
  )
  assert.equal(
    facesSupportVariationInterpolation([
      vfFace('Regular', "'wght' 400"),
      { family: 'Recoleta', italic: true, label: 'Italic', variation: "'wght' 400" },
    ]),
    false,
  )
  assert.equal(
    facesSupportVariationInterpolation([
      vfFace('Regular', "'wght' 400"),
      { family: 'Recoleta', italic: false, label: 'Bold' },
    ]),
    false,
  )
})
