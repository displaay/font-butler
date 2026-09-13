import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { pendingFontFileTasks, runFontFileTask, serializeFontNative } from './font-file-queue.ts'
import { getFontNative, noopFontNative, setFontNative } from './native.ts'
import { withService, writeTestFont } from './test-util.ts'

test('runFontFileTask yields so the caller can queue more work before the first task runs', async () => {
  const order: string[] = []
  const first = runFontFileTask(async () => {
    order.push('first')
    return 1
  })
  order.push('caller')
  await first
  assert.deepEqual(order, ['caller', 'first'])
})

test('a second font-file task can enqueue while native work is in flight', async () => {
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const order: string[] = []

  const first = runFontFileTask(async () => {
    order.push('first-start')
    await firstGate
    order.push('first-end')
    return 'a'
  })
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(pendingFontFileTasks(), 1)
  assert.deepEqual(order, ['first-start'])

  const second = runFontFileTask(async () => {
    order.push('second')
    return 'b'
  })
  assert.equal(pendingFontFileTasks(), 2)
  releaseFirst()
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b'])
  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
  assert.equal(pendingFontFileTasks(), 0)
})

test('nested native calls inside a font-file task do not deadlock', async () => {
  const native = serializeFontNative(
    noopFontNative({
      async registerFont() {
        return { ok: true, native: true }
      },
    }),
  )
  const wrappedAgain = serializeFontNative(native)
  const result = await runFontFileTask(() => wrappedAgain.registerFont('/tmp/Face.ttf'))
  assert.equal(result.ok, true)
  assert.equal(pendingFontFileTasks(), 0)
})

test('catalog and settings stay available while native install is in flight', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await withService(
    async (service, paths) => {
      await service.init()
      const source = path.join(paths.dataRoot, 'Release.ttf')
      writeTestFont(source, 'Release', 'Release-Regular')
      const imported = await service.importPaths([source])
      const install = service.install(imported.entries[0]!.id)
      try {
        let otherDone = false
        const other = Promise.resolve().then(async () => {
          await new Promise((resolve) => setImmediate(resolve))
          otherDone = true
        })
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(service.listCatalog().length, 1)
        assert.equal(typeof service.getSettings().onboardingCompleted, 'boolean')
        await other
        assert.equal(otherDone, true)
      } finally {
        release()
      }
      await install
      assert.equal(service.listCatalog()[0]?.status, 'installed')
    },
    {
      native: noopFontNative({
        async registerFont() {
          await gate
          return { ok: true, native: true }
        },
        async setFontEnabled() {
          await gate
          return { ok: true, native: true }
        },
        ensureActivation: async () => {
          await gate
          return { ok: true, native: true }
        },
      }),
    },
  )
})

test('getFontNative yields before invoking the adapter', async () => {
  const order: string[] = []
  try {
    setFontNative(
      noopFontNative({
        async registerFont() {
          order.push('native')
          return { ok: true, native: true }
        },
      }),
    )
    const pending = getFontNative().registerFont('/tmp/Face.ttf')
    order.push('caller')
    await pending
    assert.deepEqual(order, ['caller', 'native'])
  } finally {
    setFontNative(null)
  }
})
