import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  facesMatchingRestCut,
  facesSupportVariationInterpolation,
} from './variationInterpolation.ts'

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

test('hover morph checks the resting cut when roman and italic rows are mixed', () => {
  const faces = [
    { family: 'fc-roman', italic: false, variation: "'wght' 300" },
    { family: 'fc-roman', italic: false, variation: "'wght' 700" },
    { family: 'fc-italic', italic: true, variation: "'wght' 400" },
    { family: 'fc-italic', italic: true, variation: "'wght' 700" },
  ]
  const rest = faces[0]!
  assert.equal(facesSupportVariationInterpolation(faces), false)
  assert.equal(facesSupportVariationInterpolation(facesMatchingRestCut(faces, rest)), true)
  assert.deepEqual(
    facesMatchingRestCut(faces, { family: 'fc-italic', italic: true }).map((face) => face.variation),
    ["'wght' 400", "'wght' 700"],
  )
})

test('hover morph keeps mixed widths when every row is the resting italic cut', () => {
  const faces = [
    { family: 'fc-bagoss', italic: false, variation: "'wght' 400, 'wdth' 75, 'slnt' 0" },
    { family: 'fc-bagoss', italic: false, variation: "'wght' 400, 'wdth' 100, 'slnt' 0" },
    { family: 'fc-bagoss', italic: true, variation: "'wght' 400, 'wdth' 100, 'slnt' -12" },
  ]
  const rest = faces[0]!
  assert.equal(facesSupportVariationInterpolation(faces), false)
  const upright = facesMatchingRestCut(faces, rest)
  assert.equal(facesSupportVariationInterpolation(upright), true)
  assert.deepEqual(
    upright.map((face) => face.variation),
    ["'wght' 400, 'wdth' 75, 'slnt' 0", "'wght' 400, 'wdth' 100, 'slnt' 0"],
  )
})

test('facesSupportVariationInterpolation accepts retail VF rows with wght-only variation strings', () => {
  const family = 'fc-retail-vf'
  assert.equal(
    facesSupportVariationInterpolation([
      { family, italic: false, label: 'Light', variation: "'wght' 300" },
      { family, italic: false, label: 'Bold', variation: "'wght' 700" },
    ]),
    true,
  )
})
