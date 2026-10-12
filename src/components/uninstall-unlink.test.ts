import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { List } from 'lucide-react'
import { CatalogBatchButtons } from './BatchActions.tsx'
import { SidebarItem } from './Sidebar.tsx'
import { activityCountVisible } from '../lib/showTotals.ts'
import type { CatalogBatchPlan } from '../lib/batch.ts'

function plan(partial: Partial<CatalogBatchPlan> = {}): CatalogBatchPlan {
  return {
    count: 1,
    install: 0,
    installFonts: 0,
    installMissing: false,
    adobeInstall: 0,
    adobeUninstall: 0,
    activate: 0,
    deactivate: 1,
    uninstall: 1,
    uninstallAndUnlink: 1,
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
  onDeactivate: () => {},
  onUninstall: () => {},
  onUninstallAndUnlink: () => {},
  onReinstall: () => {},
  onForget: () => {},
}

test('uninstall and unlink sits next to Deactivate and Uninstall', () => {
  const buttons = renderToStaticMarkup(
    createElement(CatalogBatchButtons, { plan: plan(), busy: false, ...handlers }),
  )
  const deactivate = buttons.indexOf('Deactivate')
  const uninstall = buttons.indexOf('Uninstall')
  const unlink = buttons.indexOf('Uninstall and unlink')
  assert.ok(deactivate >= 0 && uninstall > deactivate && unlink > uninstall)
})

test('the activity badge stays hidden until Show total is on', () => {
  function activityItem(showTotal: boolean) {
    return renderToStaticMarkup(
      createElement(SidebarItem, {
        active: false,
        icon: List,
        label: 'Activity',
        count: 12,
        showTotal: activityCountVisible(showTotal, false),
        onShowTotalChange: () => {},
        onClick: () => {},
      }),
    )
  }

  const hidden = activityItem(false)
  assert.match(hidden, /Activity/)
  assert.equal(hidden.includes('>12<'), false)
  assert.equal(hidden.includes('unread'), false)
  const shown = activityItem(true)
  assert.match(shown, />12</)
})
