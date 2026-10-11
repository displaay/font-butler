import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { PREVIEW_LOAD_TIMEOUT_MS, setPreviewLoadTimeoutForTests } from '../lib/previewReady.ts'

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
globalThis.getComputedStyle = view.getComputedStyle.bind(view)
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view)
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view)
globalThis.MutationObserver = view.MutationObserver
globalThis.ResizeObserver = view.ResizeObserver
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('a failed preview shows a retry control and does not paint the unloaded family', async () => {
  setPreviewLoadTimeoutForTests(20)
  let loads = 0
  const fonts = {
    check: () => false,
    load: () => {
      loads += 1
      return new Promise(() => {})
    },
    addEventListener() {},
    removeEventListener() {},
    forEach(callback: (face: { family: string; weight: number; style: string; status: string }) => void) {
      callback({ family: 'fc-ui-error', weight: 400, style: 'normal', status: 'loading' })
    },
  }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AaPreview } = await import('./AaPreview.tsx')

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        createElement(AaPreview, {
          family: 'fc-ui-error',
          sample: 'Hamburgefonstiv',
          wait: true,
        }),
      )
    })
    assert.equal(loads, 1)
    assert.equal(host.querySelector('[role="alert"]'), null)
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const alert = host.querySelector('[role="alert"]')
    assert.ok(alert, 'failed preview shows an error')
    assert.match(alert.textContent ?? '', /Failed/)
    const retry = alert.querySelector('button')
    assert.equal(retry?.textContent, 'Retry')
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)
    assert.equal(host.querySelector('[style*="fc-ui-error"]'), null)

    await act(async () => {
      retry?.click()
    })
    assert.equal(loads, 2)
    assert.equal(host.querySelector('[role="alert"]'), null)
    assert.equal(host.querySelector('[aria-label="Loading preview"]') != null, true)
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)
    assert.equal(host.querySelector('[style*="fc-ui-error"]'), null)
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
  }
})

test('a roman plus italic variable family morphs the upright cut instead of cross-fading', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CyclingAaPreview } = await import('./AaPreview.tsx')

  const faces = [
    { family: 'fc-roman', weight: 300, italic: false, label: 'Light', variation: "'wght' 300", wait: false },
    { family: 'fc-roman', weight: 700, italic: false, label: 'Bold', variation: "'wght' 700", wait: false },
    { family: 'fc-italic', weight: 400, italic: true, label: 'Italic', variation: "'wght' 400", wait: false },
  ]
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        createElement(CyclingAaPreview, {
          faces,
          rest: faces[0],
          active: true,
          size: 3,
          sample: 'Aa',
        }),
      )
    })
    const preview = host.querySelector('[data-preview-motion]')
    assert.equal(preview?.getAttribute('data-preview-motion'), 'morph')
    assert.equal(host.querySelector('[class*="opacity-0"]'), null)
    assert.match(host.textContent ?? '', /Light|Bold/)
    assert.equal(host.textContent?.includes('Italic'), false)
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})

test('hover morph keeps one italic cut and one preview sample while the instance label changes', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CyclingAaPreview } = await import('./AaPreview.tsx')
  const { catalogHoverInstanceRows } = await import('../lib/instances.ts')
  const { groupCatalog } = await import('../lib/group.ts')
  type Face = import('../lib/types.ts').FontFaceInfo
  type Entry = import('../lib/types.ts').CatalogEntry

  function entry(id: string, face: Face, previewSample: string): Entry {
    return {
      id,
      sourcePath: `/tmp/${id}.ttf`,
      sourceMtimeMs: 1,
      sourceSize: 1,
      status: 'installed',
      faces: [face],
      format: 'ttf',
      addedAt: 1,
      updatedAt: 1,
      installedPath: `/Library/Fonts/${id}.ttf`,
      previewSample,
    }
  }
  const bagoss = groupCatalog([
    entry('bagoss', {
      familyName: 'Bagoss',
      styleName: 'Regular',
      fullName: 'Bagoss Collection VF',
      postscriptName: 'Bagoss-VF',
      isVariable: true,
      instanceCount: 4,
      instanceNames: ['Condensed Regular', 'Regular', 'Italic', 'Bold Italic'],
      namedInstances: [
        { name: 'Condensed Regular', coordinates: { wght: 400, wdth: 75, slnt: 0 } },
        { name: 'Regular', coordinates: { wght: 400, wdth: 100, slnt: 0 } },
        { name: 'Italic', coordinates: { wght: 400, wdth: 100, slnt: -12 } },
        { name: 'Bold Italic', coordinates: { wght: 700, wdth: 100, slnt: -12 } },
      ],
      weight: 400,
      italic: false,
    }, 'Aa'),
  ])[0]!
  const names = ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']
  const coolkit = groupCatalog([
    entry('coolkit', {
      familyName: 'Coolkit VF',
      styleName: 'Regular',
      fullName: 'Coolkit VF',
      postscriptName: 'CoolkitVF',
      isVariable: true,
      instanceCount: names.length,
      instanceNames: names,
      namedInstances: names.map((name, index) => ({ name, coordinates: { wght: (index + 1) * 100 } })),
      weight: 400,
      italic: false,
    }, 'Aa'),
  ])[0]!

  for (const grouped of [bagoss, coolkit]) {
    const hoverRows = catalogHoverInstanceRows(grouped)
    const variations = new Set(hoverRows.map((row) => row.variation))
    assert.ok(variations.size >= 2)
    const faces = hoverRows.map((row) => ({
      family: `fc-${row.catalogEntryId}`,
      weight: row.weight,
      italic: row.italic,
      label: row.label,
      variation: row.variation,
      sample: row.previewSample,
      wait: false,
    }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          createElement(CyclingAaPreview, {
            faces,
            rest: faces[0]!,
            active: true,
            size: 3,
          }),
        )
      })
      const preview = host.querySelector('[data-preview-motion]')
      const glyph = host.querySelector('.font-preview') as HTMLElement | null
      assert.equal(preview?.getAttribute('data-preview-motion'), 'morph')
      assert.equal(host.querySelector('[class*="opacity-0"]'), null)
      assert.match(host.textContent ?? '', /Aa/)
      assert.equal(host.textContent?.includes('ACi'), false)
      assert.equal(host.textContent?.includes('Italic'), false)
      assert.notEqual(glyph?.style.fontVariationSettings, faces[0]!.variation)

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 650))
      })
      assert.equal(preview?.getAttribute('data-preview-motion'), 'morph')
      assert.match(host.textContent ?? '', /Aa/)
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    }
  }
})
