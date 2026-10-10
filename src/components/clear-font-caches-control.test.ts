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

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)
}

test('Clear font caches runs only after confirmation and logout is optional', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ClearFontCachesControl } = await import('./ClearFontCachesControl.tsx')

  const calls: string[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      createElement(ClearFontCachesControl, {
        onClear: async () => {
          calls.push('clear')
        },
        onLogOut: async () => {
          calls.push('logout')
        },
      }),
    )
  })

  const open = buttonNamed(document.body, 'Clear font caches')
  assert.ok(open)
  await act(async () => {
    open.click()
  })

  assert.deepEqual(calls, [])
  const confirmDialog = document.body.querySelector('[role="dialog"]')
  assert.ok(confirmDialog)
  assert.match(confirmDialog.textContent ?? '', /Some apps may not see new or updated fonts until you log out/)
  const cancel = buttonNamed(confirmDialog, 'Cancel')
  assert.ok(cancel)
  await act(async () => {
    cancel.click()
  })
  assert.deepEqual(calls, [])
  assert.equal(document.body.querySelector('[role="dialog"]'), null)

  const openAgain = buttonNamed(document.body, 'Clear font caches')
  assert.ok(openAgain)
  await act(async () => {
    openAgain.click()
  })
  const confirm = document.body.querySelector('[role="dialog"]')
  assert.ok(confirm)
  const confirmButton = buttonNamed(confirm, 'Clear font caches')
  assert.ok(confirmButton)
  await act(async () => {
    confirmButton.click()
  })
  assert.deepEqual(calls, ['clear'])

  const done = document.body.querySelector('[role="dialog"]')
  assert.ok(done)
  assert.match(done.textContent ?? '', /Log out now/)
  const later = buttonNamed(done, 'Later')
  assert.ok(later)
  await act(async () => {
    later.click()
  })
  assert.deepEqual(calls, ['clear'])
  assert.equal(document.body.querySelector('[role="dialog"]'), null)

  const openThird = buttonNamed(document.body, 'Clear font caches')
  assert.ok(openThird)
  await act(async () => {
    openThird.click()
  })
  const confirmAgain = document.body.querySelector('[role="dialog"]')
  assert.ok(confirmAgain)
  const confirmAgainButton = buttonNamed(confirmAgain, 'Clear font caches')
  assert.ok(confirmAgainButton)
  await act(async () => {
    confirmAgainButton.click()
  })
  const logout = buttonNamed(document.body, 'Log out now')
  assert.ok(logout)
  await act(async () => {
    logout.click()
  })
  assert.deepEqual(calls, ['clear', 'clear', 'logout'])

  await act(async () => {
    root.render(
      createElement(ClearFontCachesControl, {
        onClear: async () => {
          calls.push('clear')
        },
        onLogOut: async () => {
          calls.push('logout-denied')
          return { requested: false, message: 'Use Apple menu > Log Out' }
        },
      }),
    )
  })
  const openDenied = buttonNamed(document.body, 'Clear font caches')
  assert.ok(openDenied)
  await act(async () => {
    openDenied.click()
  })
  const confirmDenied = document.body.querySelector('[role="dialog"]')
  assert.ok(confirmDenied)
  const confirmDeniedButton = buttonNamed(confirmDenied, 'Clear font caches')
  assert.ok(confirmDeniedButton)
  await act(async () => {
    confirmDeniedButton.click()
  })
  const logoutDenied = buttonNamed(document.body, 'Log out now')
  assert.ok(logoutDenied)
  await act(async () => {
    logoutDenied.click()
  })
  const failed = document.body.querySelector('[role="dialog"]')
  assert.ok(failed)
  assert.match(failed.textContent ?? '', /Logging out didn't happen/)
  assert.match(failed.textContent ?? '', /Apple menu > Log Out/)
  assert.match(failed.textContent ?? '', /rebuilding font caches/)
  assert.ok(buttonNamed(failed, 'OK'))
  assert.equal(buttonNamed(failed, 'Log out now'), undefined)

  const failures = [
    {
      name: '-1743',
      result: {
        requested: false,
        message: "Logging out didn't happen. Use Apple menu > Log Out to finish rebuilding font caches.",
        error: 'osascript is not allowed to send keystrokes. (-1743)',
      },
    },
    {
      name: 'generic',
      result: {
        requested: false,
        message: "Logging out didn't happen. Use Apple menu > Log Out to finish rebuilding font caches.",
        error: 'osascript failed: System Events is not running',
      },
    },
    {
      name: 'timeout',
      result: {
        requested: false,
        message: "Logging out didn't happen. Use Apple menu > Log Out to finish rebuilding font caches.",
        error: 'spawn osascript ETIMEDOUT: timed out',
      },
    },
  ]
  const previousNotification = globalThis.Notification
  class DeniedNotification {
    static permission = 'denied'
    static isSupported() {
      return false
    }
    constructor() {
      throw new Error('notifications unavailable')
    }
    show() {
      throw new Error('notifications unavailable')
    }
  }
  globalThis.Notification = DeniedNotification as unknown as typeof Notification
  try {
    for (const failure of failures) {
      await act(async () => {
        root.render(
          createElement(ClearFontCachesControl, {
            onClear: async () => {
              calls.push(`clear-${failure.name}`)
            },
            onLogOut: async () => {
              calls.push(`logout-${failure.name}`)
              if (globalThis.Notification) {
                try {
                  new globalThis.Notification('Font Buttler')
                } catch {
                  // Permission is denied. The dialog still has to appear.
                }
              }
              return failure.result
            },
          }),
        )
      })
      const openFailure = buttonNamed(document.body, 'Clear font caches')
      assert.ok(openFailure, failure.name)
      await act(async () => {
        openFailure.click()
      })
      const confirmFailure = document.body.querySelector('[role="dialog"]')
      assert.ok(confirmFailure, failure.name)
      const confirmFailureButton = buttonNamed(confirmFailure, 'Clear font caches')
      assert.ok(confirmFailureButton, failure.name)
      await act(async () => {
        confirmFailureButton.click()
      })
      const logoutFailure = buttonNamed(document.body, 'Log out now')
      assert.ok(logoutFailure, failure.name)
      await act(async () => {
        logoutFailure.click()
      })
      const dialog = document.body.querySelector('[role="dialog"]')
      assert.ok(dialog, failure.name)
      assert.match(dialog.textContent ?? '', /Logging out didn't happen/)
      assert.match(dialog.textContent ?? '', /Apple menu > Log Out/)
      assert.match(dialog.textContent ?? '', /rebuilding font caches/)
      assert.equal(globalThis.Notification, DeniedNotification)
    }
  } finally {
    globalThis.Notification = previousNotification
  }

  await act(async () => {
    root.unmount()
  })
  host.remove()
  await dom.happyDOM.close()
})
