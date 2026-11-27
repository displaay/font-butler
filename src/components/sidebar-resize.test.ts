import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_KEY } from '../lib/sidebarWidth.ts'

const dom = new Window({
  url: 'http://127.0.0.1:43181/',
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
})

const view = dom as unknown as Window & typeof globalThis
view.innerWidth = 1400
globalThis.window = view
globalThis.document = view.document
globalThis.localStorage = view.localStorage
globalThis.HTMLElement = view.HTMLElement
globalThis.Element = view.Element
globalThis.Node = view.Node
globalThis.DocumentFragment = view.DocumentFragment
globalThis.SVGElement = view.SVGElement
globalThis.Event = view.Event
globalThis.KeyboardEvent = view.KeyboardEvent
globalThis.PointerEvent = view.PointerEvent
globalThis.MouseEvent = view.MouseEvent
globalThis.getComputedStyle = view.getComputedStyle.bind(view)
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view)
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view)
globalThis.MutationObserver = view.MutationObserver
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { SidebarResizeHandle } = await import('./SidebarResizeHandle.tsx')
const { useSidebarResize } = await import('./useSidebarResize.ts')
const { LibraryFilterGroups } = await import('./Sidebar.tsx')

function ResizeHarness() {
  const resize = useSidebarResize()
  return React.createElement(
    'div',
    { 'data-width': resize.width, 'data-dragging': resize.dragging ? 'true' : 'false' },
    React.createElement(SidebarResizeHandle, {
      width: resize.width,
      dragging: resize.dragging,
      min: resize.bounds.min,
      max: resize.bounds.max,
      onPointerDown: resize.onPointerDown,
      onDoubleClick: resize.reset,
      onKeyDown: resize.onKeyDown,
    }),
  )
}

function separator(): HTMLElement {
  const handle = document.querySelector('[role="separator"]')
  assert.ok(handle instanceof view.HTMLElement)
  return handle
}

function pointer(type: string, clientX: number) {
  return new view.PointerEvent(type, { clientX, button: 0, bubbles: true, cancelable: true })
}

test('drag, keyboard, and double-click resize the sidebar and persist it', async () => {
  view.innerWidth = 1400
  view.localStorage.removeItem(SIDEBAR_WIDTH_KEY)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(React.createElement(ResizeHarness))
  })

  const handle = separator()
  assert.equal(handle.getAttribute('aria-orientation'), 'vertical')
  assert.equal(handle.getAttribute('aria-label'), 'Resize sidebar')
  assert.equal(handle.getAttribute('aria-valuemin'), '200')
  assert.equal(handle.getAttribute('aria-valuemax'), '420')
  assert.equal(handle.getAttribute('aria-valuenow'), String(SIDEBAR_DEFAULT_WIDTH))
  assert.match(handle.className, /cursor-col-resize/)
  assert.match(handle.className, /select-none/)
  assert.match(handle.className, /(?:^|\s)hidden(?:\s|$)/)
  assert.match(handle.className, /md:block/)
  assert.match(handle.className, /-right-2/)
  assert.match(handle.className, /(?:^|\s)w-2(?:\s|$)/)
  assert.match(handle.className, /z-30/)
  assert.doesNotMatch(handle.className, /(?:^|\s)right-0(?:\s|$)/)
  assert.equal(host.firstElementChild?.getAttribute('data-width'), String(SIDEBAR_DEFAULT_WIDTH))

  await act(async () => {
    handle.dispatchEvent(pointer('pointerdown', 100))
  })
  assert.equal(document.documentElement.hasAttribute('data-sidebar-resizing'), true)
  assert.equal(host.firstElementChild?.getAttribute('data-dragging'), 'true')

  await act(async () => {
    window.dispatchEvent(pointer('pointermove', 164))
  })
  assert.equal(host.firstElementChild?.getAttribute('data-width'), '288')

  await act(async () => {
    window.dispatchEvent(pointer('pointerup', 164))
  })
  assert.equal(document.documentElement.hasAttribute('data-sidebar-resizing'), false)
  assert.equal(view.localStorage.getItem(SIDEBAR_WIDTH_KEY), '288')

  await act(async () => {
    handle.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
  })
  assert.equal(view.localStorage.getItem(SIDEBAR_WIDTH_KEY), '272')

  await act(async () => {
    handle.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  })
  assert.equal(view.localStorage.getItem(SIDEBAR_WIDTH_KEY), '288')

  await act(async () => {
    handle.dispatchEvent(new view.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  })
  assert.equal(host.firstElementChild?.getAttribute('data-width'), String(SIDEBAR_DEFAULT_WIDTH))
  assert.equal(view.localStorage.getItem(SIDEBAR_WIDTH_KEY), String(SIDEBAR_DEFAULT_WIDTH))

  await act(async () => {
    handle.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
  })
  assert.equal(view.localStorage.getItem(SIDEBAR_WIDTH_KEY), String(SIDEBAR_DEFAULT_WIDTH))

  view.innerWidth = 700
  await act(async () => {
    window.dispatchEvent(new view.Event('resize'))
  })
  assert.equal(host.firstElementChild?.getAttribute('data-width'), '220')
  assert.equal(view.localStorage.getItem(SIDEBAR_WIDTH_KEY), '220')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

test('filter rows truncate labels and keep count badges from shrinking', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(LibraryFilterGroups, {
        libraryFilters: [],
        libraryFilterCounts: { installed: 12, deactivated: 3, uninstalled: 4 },
        onLibraryFiltersChange: () => {},
        filterGroupsOpen: { Status: true },
        onFilterGroupsOpenChange: () => {},
      }),
    )
  })

  const installed = document.querySelector('button[aria-label="Filter installed"]')
  assert.ok(installed instanceof view.HTMLElement)
  assert.match(installed.className, /min-w-0/)
  assert.match(installed.className, /max-w-full/)
  const label = installed.querySelector('span')
  const badge = installed.querySelector('span.ml-auto, span[class*="shrink-0"]')
  assert.ok(label)
  assert.match(label.className, /min-w-0/)
  assert.match(label.className, /truncate/)
  assert.match(label.className, /flex-1/)
  const count = [...installed.querySelectorAll('span')].find((node) => node.textContent?.trim() === '12')
  assert.ok(count, 'expected the installed count badge')
  assert.match(count.className, /shrink-0/)
  assert.match(count.className, /ml-auto/)
  assert.equal(badge?.textContent?.trim(), '12')

  await act(async () => {
    root.unmount()
  })
  host.remove()
})

test('sidebar column locks its width and stops the scroll viewport from growing', async () => {
  const css = await readFile(new URL('../index.css', import.meta.url), 'utf8')
  const sidebar = await readFile(new URL('./Sidebar.tsx', import.meta.url), 'utf8')
  const handle = await readFile(new URL('./SidebarResizeHandle.tsx', import.meta.url), 'utf8')
  assert.match(css, /\.sidebar-column \[data-radix-scroll-area-viewport\] > div \{[\s\S]*min-width: 0 !important/)
  assert.match(css, /overflow-x: hidden !important/)
  assert.match(css, /width: var\(--sidebar-width, 14rem\)/)
  const asideOpen = sidebar.slice(sidebar.indexOf('<aside'), sidebar.indexOf('>', sidebar.indexOf('<aside')) + 1)
  assert.match(asideOpen, /overflow-visible/)
  assert.doesNotMatch(asideOpen, /overflow-x-hidden/)
  assert.match(sidebar, /overflow-x-hidden/)
  assert.match(sidebar, /--sidebar-width/)
  assert.doesNotMatch(sidebar, /md:w-56/)
  assert.match(sidebar, /<SidebarResizeHandle/)
  assert.match(sidebar, /min-w-0 flex-1 truncate/)
  assert.match(sidebar, /ml-auto shrink-0/)
  assert.match(handle, /-right-2/)
  assert.match(handle, /w-2/)
  assert.match(handle, /left-0 w-px/)
  assert.doesNotMatch(handle, /right-0/)
})

after(() => {
  view.close()
})
