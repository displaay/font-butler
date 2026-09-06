import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clickOpensInspector,
  collapseInspector,
  DEFAULT_INSPECTOR_DENSITY,
  expandInspector,
  inspectorPaneClass,
  inspectorRailClass,
  inspectorUsesCardRail,
} from './inspector.ts'

test('expandInspector steps compact → expanded → specimen', () => {
  assert.equal(expandInspector('compact'), 'expanded')
  assert.equal(expandInspector('expanded'), 'specimen')
  assert.equal(expandInspector('specimen'), 'specimen')
})

test('collapseInspector steps specimen → expanded → compact → closed', () => {
  assert.equal(collapseInspector('specimen'), 'expanded')
  assert.equal(collapseInspector('expanded'), 'compact')
  assert.equal(collapseInspector('compact'), null)
})

test('opening the inspector defaults to the wide workspace', () => {
  assert.equal(DEFAULT_INSPECTOR_DENSITY, 'expanded')
})

test('clickOpensInspector only fires on a plain reselect', () => {
  assert.equal(clickOpensInspector(['Inter'], 'Inter', {}), true)
  assert.equal(clickOpensInspector(['Inter'], 'Geist', {}), false)
  assert.equal(clickOpensInspector(['Inter', 'Geist'], 'Inter', {}), false)
  assert.equal(clickOpensInspector(['Inter'], 'Inter', { toggle: true }), false)
  assert.equal(clickOpensInspector(['Inter'], 'Inter', { range: true }), false)
  assert.equal(clickOpensInspector([], 'Inter', {}), false)
})

test('inspector pane and rail classes keep browse context', () => {
  assert.match(inspectorPaneClass('compact'), /md:w-96/)
  assert.match(inspectorPaneClass('expanded'), /flex-1/)
  assert.match(inspectorPaneClass('specimen'), /flex-1/)
  assert.match(inspectorRailClass('compact'), /md:flex-1/)
  assert.match(inspectorRailClass('expanded'), /md:w-56/)
  assert.match(inspectorRailClass('specimen'), /md:w-44/)
  assert.equal(inspectorUsesCardRail('compact'), false)
  assert.equal(inspectorUsesCardRail('expanded'), true)
  assert.equal(inspectorUsesCardRail('specimen'), true)
})
