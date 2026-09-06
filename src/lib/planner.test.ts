import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classificationLabel, collectionImportScope, planChoiceLabel, planNeedsReview } from './planner.ts'
import type { ImportPlan } from './types.ts'

function plan(items: ImportPlan['items']): ImportPlan {
  return {
    id: 'plan',
    items,
    summary: { add: 1, install: 1, unchanged: 0, review: 0, preview: 0 },
  }
}

test('planNeedsReview is true for format conflicts and collection overlap', () => {
  assert.equal(
    planNeedsReview(
      plan([
        {
          id: 'a',
          path: '/tmp/A.otf',
          classification: 'new',
          defaultChoice: 'keep',
          choices: ['keep'],
        },
      ]),
    ),
    false,
  )
  assert.equal(
    planNeedsReview(
      plan([
        {
          id: 'b',
          path: '/tmp/B.ttf',
          classification: 'alt-format',
          defaultChoice: 'keep',
          choices: ['keep', 'replace'],
        },
      ]),
    ),
    true,
  )
  assert.equal(
    planNeedsReview(
      plan([
        {
          id: 'overlap',
          path: '/tmp/Pack.ttc',
          classification: 'collection-overlap',
          defaultChoice: 'keep',
          choices: ['keep', 'replace'],
        },
      ]),
    ),
    true,
  )
})

test('planNeedsReview is true for same-identity add-inactive copies', () => {
  assert.equal(
    planNeedsReview(
      plan([
        {
          id: 'c',
          path: '/tmp/C.ttf',
          classification: 'revision',
          parallelCopy: true,
          defaultChoice: 'skip',
          choices: ['replace', 'add-inactive', 'install-as', 'skip'],
        },
      ]),
    ),
    true,
  )
})

test('classificationLabel names preview-only web fonts', () => {
  assert.equal(
    classificationLabel({
      id: 'w',
      path: '/tmp/W.woff',
      classification: 'new',
      previewOnly: true,
      defaultChoice: 'keep',
      choices: ['keep'],
    }),
    'Web font · Preview only',
  )
})

test('planChoiceLabel names duplicate resolutions', () => {
  assert.equal(planChoiceLabel('replace'), 'Replace active')
  assert.equal(planChoiceLabel('add-inactive'), 'Add inactive copy')
  assert.equal(planChoiceLabel('install-as'), 'Install as…')
  assert.equal(planChoiceLabel('switch'), 'Switch')
})

test('classificationLabel and collectionImportScope describe collection file scope', () => {
  assert.equal(
    classificationLabel({
      id: 'ttc',
      path: '/tmp/Pack.ttc',
      classification: 'collection-overlap',
      defaultChoice: 'keep',
      choices: ['keep', 'replace'],
    }),
    'Collection overlap',
  )
  assert.equal(
    collectionImportScope({
      id: 'ttc',
      path: '/tmp/Pack.ttc',
      classification: 'collection-overlap',
      affectedFaces: ['Pack Regular', 'Pack Bold'],
      defaultChoice: 'keep',
      choices: ['keep', 'replace'],
    }),
    'This changes all 2 faces in this collection: Pack Regular, Pack Bold',
  )
  assert.equal(
    collectionImportScope({
      id: 'solo',
      path: '/tmp/Solo.ttf',
      classification: 'new',
      faces: [
        {
          familyName: 'Solo',
          styleName: 'Regular',
          fullName: 'Solo Regular',
          postscriptName: 'Solo-Regular',
          isVariable: false,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
      affectedFaces: ['Solo Regular'],
      defaultChoice: 'keep',
      choices: ['keep'],
    }),
    null,
  )
})
