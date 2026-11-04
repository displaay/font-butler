import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'

const dom = new Window({
  url: 'http://127.0.0.1:43181/',
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
})

const view = dom as unknown as Window & typeof globalThis
globalThis.window = view
globalThis.document = view.document
globalThis.HTMLElement = view.HTMLElement
globalThis.Element = view.Element
globalThis.Node = view.Node
globalThis.DocumentFragment = view.DocumentFragment
globalThis.SVGElement = view.SVGElement
globalThis.Event = view.Event
globalThis.KeyboardEvent = view.KeyboardEvent
globalThis.getComputedStyle = view.getComputedStyle.bind(view)
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view)
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view)
globalThis.MutationObserver = view.MutationObserver
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { LibrarySearch } = await import('./LibrarySearch.tsx')

function optionLabels(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent?.trim() ?? '')
}

function press(key: string) {
  const input = document.querySelector('input')
  assert.ok(input)
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

async function type(value: string) {
  const input = document.querySelector('input')
  assert.ok(input instanceof view.HTMLInputElement)
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new view.Event('input', { bubbles: true }))
}

function Harness() {
  const [text, setText] = useState('')
  const [tokens, setTokens] = useState<string[]>([])
  const [filters, setFilters] = useState<string[]>([])
  return createElement(
    'div',
    null,
    createElement(LibrarySearch, {
      text,
      tokens: tokens.map((id) => ({ id, label: id, group: 'style' as const })),
      tags: [
        { id: 'trial', name: 'Trial' },
        { id: 'open-source', name: 'Open Source' },
      ],
      foundries: ['Displaay'],
      libraryFilters: filters,
      onTextChange: setText,
      onTokensChange: (next) => setTokens(next.map((token) => token.id)),
      onLibraryFiltersChange: setFilters,
    }),
    createElement('p', { 'data-query': text }, text),
    createElement('p', { 'data-tokens': tokens.join(',') }, tokens.join(',')),
    createElement('p', { 'data-filters': filters.join(',') }, filters.join(',')),
  )
}

test('arrow keys and Enter apply the highlighted filter and leave the rest of the query', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(Harness))
  })

  await act(async () => {
    await type('fig')
  })
  assert.deepEqual(optionLabels(), ['Tabular Figures', 'Old-Style Figures'])

  await act(async () => {
    press('ArrowDown')
  })
  const options = [...document.querySelectorAll('[role="option"]')]
  assert.equal(options[1]?.getAttribute('aria-selected'), 'true')
  await act(async () => {
    press('ArrowUp')
  })
  assert.equal(document.querySelectorAll('[role="option"]')[0]?.getAttribute('aria-selected'), 'true')
  await act(async () => {
    press('ArrowDown')
  })
  await act(async () => {
    press('Enter')
  })
  assert.equal(document.querySelector('[data-query]')?.getAttribute('data-query'), '')
  assert.equal(document.querySelector('[data-tokens]')?.getAttribute('data-tokens'), 'oldstyle')
  assert.equal(document.querySelector('[role="listbox"]'), null)

  await act(async () => {
    await type('var')
  })
  assert.deepEqual(optionLabels(), ['Variable'])
  await act(async () => {
    press('Escape')
  })
  assert.equal(document.querySelector('[role="listbox"]'), null)
  assert.equal(document.querySelector('[data-tokens]')?.getAttribute('data-tokens'), 'oldstyle')

  await act(async () => {
    await type('review sans')
  })
  const sans = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.trim() === 'Sans Serif')
  assert.ok(sans instanceof view.HTMLElement)
  await act(async () => {
    sans.click()
  })
  assert.equal(document.querySelector('[data-query]')?.getAttribute('data-query'), 'review')
  assert.equal(document.querySelector('[data-filters]')?.getAttribute('data-filters'), 'classification:sans-serif')
  assert.equal(document.querySelector('[data-tokens]')?.getAttribute('data-tokens'), 'oldstyle')
  assert.equal(document.querySelector('[role="listbox"]'), null)

  await act(async () => {
    root.unmount()
  })
  host.remove()
})
