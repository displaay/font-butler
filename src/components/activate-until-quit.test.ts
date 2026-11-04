import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatalogCardActions } from './FontCardActions.tsx'
import { TooltipProvider } from './ui/tooltip.tsx'
import { ACTIVATE_UNTIL_QUIT_LABEL } from '../lib/batch.ts'
import type { CatalogBatchPlan } from '../lib/batch.ts'

function plan(partial: Partial<CatalogBatchPlan> = {}): CatalogBatchPlan {
  return {
    count: 1,
    install: 0,
    installFonts: 0,
    installMissing: false,
    adobeInstall: 0,
    adobeUninstall: 0,
    activate: 1,
    deactivate: 0,
    uninstall: 0,
    uninstallAndUnlink: 0,
    uninstallAndRemove: 0,
    reinstall: 0,
    repair: 0,
    forget: 0,
    deleteFiles: 0,
    ...partial,
  }
}

const handlers = {
  onInstall: () => {},
  onActivate: () => {},
  onActivateUntilQuit: () => {},
  onDeactivate: () => {},
  onUninstall: () => {},
  onReinstall: () => {},
  onForget: () => {},
}

function card(partial: Partial<CatalogBatchPlan> = {}) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(CatalogCardActions, {
        plan: plan(partial),
        missingSource: false,
        busy: false,
        visible: true,
        ...handlers,
      }),
    ),
  )
}

test('the card offers Activate until quit for a face that is off', () => {
  const markup = card()
  assert.match(markup, new RegExp(`aria-label="${ACTIVATE_UNTIL_QUIT_LABEL}"`))
  const uninstalled = card({ activate: 0, install: 1, installFonts: 1 })
  assert.match(uninstalled, new RegExp(`aria-label="${ACTIVATE_UNTIL_QUIT_LABEL}"`))
})

test('Activate until quit is hidden when the face is already on', () => {
  const markup = card({ activate: 0, install: 0, deactivate: 1 })
  assert.equal(markup.includes(ACTIVATE_UNTIL_QUIT_LABEL), false)
})
