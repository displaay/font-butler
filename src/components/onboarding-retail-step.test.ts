import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { AppSettings, RetailSyncStatus } from '../lib/types.ts'

const dom = new Window({
  url: 'http://127.0.0.1:43181/',
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
})

const view = dom as unknown as Window & typeof globalThis
const keepNodeBuiltins = new Set([
  'AbortController',
  'AbortSignal',
  'Array',
  'ArrayBuffer',
  'Blob',
  'Boolean',
  'BroadcastChannel',
  'Buffer',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'File',
  'Float32Array',
  'Float64Array',
  'FormData',
  'Function',
  'Headers',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'MessageChannel',
  'MessagePort',
  'Number',
  'Object',
  'Promise',
  'RangeError',
  'ReadableStream',
  'ReferenceError',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TextDecoder',
  'TextEncoder',
  'TransformStream',
  'TypeError',
  'URIError',
  'URL',
  'URLSearchParams',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
  'WritableStream',
])
globalThis.window = view
globalThis.document = view.document
for (const key of new Set([
  ...Object.getOwnPropertyNames(view),
  ...Object.getOwnPropertyNames(Object.getPrototypeOf(view)),
])) {
  if (!/^[A-Z]/.test(key) || keepNodeBuiltins.has(key)) continue
  try {
    ;(globalThis as Record<string, unknown>)[key] = (view as unknown as Record<string, unknown>)[key]
  } catch {
    // Some window accessors are not writable from Node.
  }
}
globalThis.getComputedStyle = view.getComputedStyle.bind(view)
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view)
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view)
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const settings = {
  version: 1,
  watchFolders: [],
  defaultView: 'grid',
  defaultSort: 'name',
  installAfterUpload: true,
  installWatchFolderFonts: true,
  theme: 'system',
  menuBarIcon: true,
  openAtLogin: false,
  clearOfficeFontCache: false,
  clearAdobeFontCache: false,
  autoReinstallOnUpdate: false,
  skipCacheClearOnReinstall: false,
  nativeNotifications: false,
  onboardingCompleted: false,
} as AppSettings

const retailStatus: RetailSyncStatus = {
  enabled: false,
  autoCheckMinutes: 60,
  configured: false,
  hasToken: false,
  mode: null,
  workerBaseUrl: 'https://w.displaay.net',
  checkedAt: null,
  syncedAt: null,
  pending: 0,
  drift: [],
  skipped: [],
  error: null,
  fonts: [],
  disabledGlyphsFiles: [],
  familyFormats: {},
  collisions: [],
  incomplete: false,
  progress: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('the onboarding folders step shows Trial on the Displaay retail heading before the list loads', async () => {
  let releaseStatus: (() => void) | null = null
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve
  })
  const calls: string[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.includes('/api/bootstrap')) {
      return jsonResponse({ token: 'test-token', settings })
    }
    if (url.includes('/api/destinations')) {
      return jsonResponse({ destinations: [], investigation: [] })
    }
    if (url.includes('/api/retail/status')) {
      await statusGate
      return jsonResponse({ status: retailStatus })
    }
    if (url.includes('/api/settings')) {
      return jsonResponse({
        settings,
        officeFontCache: { path: '', exists: false },
        adobeFontCache: { exists: false, paths: [], roots: [] },
      })
    }
    return jsonResponse({ error: `unexpected ${url}` }, 404)
  }

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { OnboardingDialog } = await import('./OnboardingDialog.tsx')

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let current = settings

  await act(async () => {
    root.render(
      createElement(OnboardingDialog, {
        open: true,
        settings: current,
        onSettingsChange: (next: AppSettings) => {
          current = next
        },
        onComplete: () => {},
      }),
    )
  })

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const started = Date.now()
  let startButton: HTMLButtonElement | null = null
  while (!startButton) {
    await settle()
    startButton =
      [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Get started') ??
      null
    if (!startButton && Date.now() - started > 3000) {
      throw new Error(`Get started did not render. body=${document.body.textContent?.slice(0, 400)}`)
    }
  }

  await act(async () => {
    startButton.click()
  })

  const opened = Date.now()
  let heading: HTMLElement | null = null
  while (!heading) {
    await settle()
    heading =
      [...document.querySelectorAll('h3')].find((node) => node.textContent?.includes('Displaay retail')) ?? null
    if (!heading && Date.now() - opened > 3000) {
      throw new Error(
        `Displaay retail heading did not render. calls=${calls.join(', ')} body=${document.body.textContent?.slice(0, 500)}`,
      )
    }
  }

  assert.match(document.body.textContent ?? '', /Watch folders/)
  assert.match(heading.textContent ?? '', /Displaay retail/)
  assert.match(heading.textContent ?? '', /Trial/)
  assert.equal(
    heading.querySelector('[title="Displaay trial font. Save a token with retail access in Settings to sync the full files."]')
      ?.textContent,
    'Trial',
  )
  assert.equal(document.body.querySelector('[aria-label="Displaay retail sync"]')?.textContent?.includes('Off'), true)
  assert.equal((document.body.textContent ?? '').includes('Reckless'), false)
  assert.equal(calls.some((call) => call.includes('/api/retail/check')), false)

  await act(async () => {
    releaseStatus?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await settle()

  const after = [...document.querySelectorAll('h3')].find((node) => node.textContent?.includes('Displaay retail'))
  assert.match(after?.textContent ?? '', /Trial/)
  assert.equal((document.body.textContent ?? '').includes('Reckless'), false)

  await act(async () => {
    root.unmount()
  })
  host.remove()
  await dom.happyDOM.close()
})
