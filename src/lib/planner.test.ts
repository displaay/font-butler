import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classificationLabel, planNeedsReview } from './planner.ts'
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
