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

test('hover morph keeps the resting width when a family mixes width cuts', () => {
  const faces = [
    { family: 'fc-bagoss', italic: false, widthClass: 'condensed', variation: "'wght' 400, 'wdth' 75" },
    { family: 'fc-bagoss', italic: false, widthClass: 'condensed', variation: "'wght' 500, 'wdth' 75" },
    { family: 'fc-bagoss', italic: false, widthClass: 'normal', variation: "'wght' 400, 'wdth' 100" },
  ]
  const rest = faces[0]!
  assert.equal(facesSupportVariationInterpolation(faces), false)
  assert.equal(facesSupportVariationInterpolation(facesMatchingRestCut(faces, rest)), true)
  assert.deepEqual(
    facesMatchingRestCut(faces, rest).map((face) => face.widthClass),
    ['condensed', 'condensed'],
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
