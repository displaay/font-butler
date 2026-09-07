import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clickOpensInspector,
  collapseInspector,
  DEFAULT_INSPECTOR_DENSITY,
  expandInspector,
  inspectorHidesBrowseGrid,
} from './inspector.ts'

test('opening details uses the full right pane, not a compact drawer', () => {
  assert.equal(DEFAULT_INSPECTOR_DENSITY, 'expanded')
})

test('expandInspector stays inside the details pane (specimen, no card rail)', () => {
  assert.equal(expandInspector('expanded'), 'specimen')
  assert.equal(expandInspector('specimen'), 'specimen')
})

test('collapseInspector restores the grid from every details density', () => {
  assert.equal(collapseInspector('expanded'), null)
  assert.equal(collapseInspector('specimen'), null)
})

test('open details hide the browse grid instead of splitting a card rail', () => {
  assert.equal(inspectorHidesBrowseGrid(true), true)
  assert.equal(inspectorHidesBrowseGrid(false), false)
})

test('clickOpensInspector only fires on a plain reselect', () => {
  assert.equal(clickOpensInspector(['Inter'], 'Inter', {}), true)
  assert.equal(clickOpensInspector(['Inter'], 'Geist', {}), false)
  assert.equal(clickOpensInspector(['Inter', 'Geist'], 'Inter', {}), false)
  assert.equal(clickOpensInspector(['Inter'], 'Inter', { toggle: true }), false)
  assert.equal(clickOpensInspector(['Inter'], 'Inter', { range: true }), false)
  assert.equal(clickOpensInspector([], 'Inter', {}), false)
})
