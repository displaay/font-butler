import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent, takePendingUnlinkedListResetNotice } from './events.ts'
import type { AppPaths } from './paths.ts'
import { tempPaths } from './test-util.ts'
import {
  allowUnlinkedSource,
  isUnlinkedSource,
  rememberUnlinkedSource,
  setUnlinkedBackupRenameForTest,
  setUnlinkedCaseModeForTest,
  setUnlinkedListReadForTest,
  setUnlinkedListSaveFaultForTest,
} from './unlinked-sources.ts'

function withTemp(run: (paths: AppPaths) => void): void {
  const paths = tempPaths('font-butler-unlinked-')
  try {
    run(paths)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
}

function listFile(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'unlinked-sources.json')
}

test('unlinked path keys treat composed and decomposed names as the same file', () => {
  withTemp((paths) => {
    const composed = path.join(paths.dataRoot, 'Café.otf')
    const decomposed = composed.normalize('NFD')
    assert.notEqual(composed, decomposed)
    rememberUnlinkedSource(paths, decomposed)
    assert.equal(isUnlinkedSource(paths, composed), true)
    assert.equal(isUnlinkedSource(paths, decomposed), true)
    const stored = JSON.parse(fs.readFileSync(listFile(paths), 'utf8')) as { paths: string[] }
    const expected = path.join(fs.realpathSync.native(paths.dataRoot), 'Café.otf').normalize('NFC')
    assert.equal(stored.paths[0], expected)
    allowUnlinkedSource(paths, composed)
    assert.equal(isUnlinkedSource(paths, decomposed), false)
  })
})

test('unlinked path keys fold case only on case-insensitive volumes', () => {
  const upperName = path.join('Fonts', 'Reckless.otf')
  const lowerName = path.join('fonts', 'reckless.otf')
  withTemp((paths) => {
    const upper = path.join(paths.dataRoot, upperName)
    const lower = path.join(paths.dataRoot, lowerName)
    rememberUnlinkedSource(paths, upper)
    assert.equal(isUnlinkedSource(paths, lower), false)
    assert.equal(isUnlinkedSource(paths, upper), true)
    const stored = JSON.parse(fs.readFileSync(listFile(paths), 'utf8')) as { paths: string[] }
    assert.equal(stored.paths[0], stored.paths[0].normalize('NFC'))
    assert.notEqual(stored.paths[0], stored.paths[0].toLowerCase())
  })
  for (const mode of ['insensitive', 'unknown'] as const) {
    setUnlinkedCaseModeForTest(mode)
    try {
      withTemp((paths) => {
        const upper = path.join(paths.dataRoot, upperName)
        const lower = path.join(paths.dataRoot, lowerName)
        rememberUnlinkedSource(paths, upper)
        assert.equal(isUnlinkedSource(paths, lower), true, mode)
        allowUnlinkedSource(paths, lower)
        assert.equal(isUnlinkedSource(paths, upper), false, mode)
      })
    } finally {
      setUnlinkedCaseModeForTest(null)
    }
  }
})

test('a missing unlinked file keeps the real parent directory', () => {
  withTemp((paths) => {
    const real = path.join(paths.dataRoot, 'real')
    fs.mkdirSync(real)
    const link = path.join(paths.dataRoot, 'link')
    fs.symlinkSync(real, link)
    const viaLink = path.join(link, 'Font.otf')
    rememberUnlinkedSource(paths, viaLink)
    const stored = JSON.parse(fs.readFileSync(listFile(paths), 'utf8')) as { paths: string[] }
    const expected = path.join(fs.realpathSync.native(real), 'Font.otf').normalize('NFC')
    assert.equal(stored.paths[0], expected)
    assert.equal(isUnlinkedSource(paths, path.join(real, 'Font.otf')), true)
  })
})

test('a corrupt unlinked-sources file is moved to a bak before a new list is written', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const corrupt = '{"version":1,"paths":["/earlier/Font.otf"]'
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, corrupt)
    const fresh = path.join(paths.dataRoot, 'New.otf')
    rememberUnlinkedSource(paths, fresh)
    assert.equal(fs.readFileSync(`${target}.bak`, 'utf8'), corrupt)
    const stored = JSON.parse(fs.readFileSync(target, 'utf8')) as { version: number; paths: string[] }
    assert.equal(stored.version, 1)
    assert.equal(isUnlinkedSource(paths, fresh), true)
    assert.equal(stored.paths.includes('/earlier/Font.otf'), false)
  })
})

test('a wrong-shape unlinked list uses a valid bak and merges it without replacing that bak', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const earlier = path.join(paths.dataRoot, 'Earlier.otf')
    const fresh = path.join(paths.dataRoot, 'Fresh.otf')
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    const bakBody = JSON.stringify({ version: 1, paths: [path.resolve(earlier)] })
    fs.writeFileSync(`${target}.bak`, bakBody)
    const wrong = JSON.stringify({ version: 2, paths: ['/ignored/Shape.otf'] })
    fs.writeFileSync(target, wrong)
    assert.equal(isUnlinkedSource(paths, earlier), true)
    assert.equal(isUnlinkedSource(paths, fresh), false)
    rememberUnlinkedSource(paths, fresh)
    assert.equal(fs.readFileSync(`${target}.bak`, 'utf8'), bakBody)
    const stamped = fs.readdirSync(paths.dataRoot).filter((name) => name.includes('.bak') && name !== 'unlinked-sources.json.bak')
    assert.equal(stamped.length, 1)
    assert.equal(fs.readFileSync(path.join(paths.dataRoot, stamped[0]!), 'utf8'), wrong)
    const stored = JSON.parse(fs.readFileSync(target, 'utf8')) as { paths: string[] }
    assert.equal(stored.paths.some((item) => item.endsWith('Earlier.otf')), true)
    assert.equal(stored.paths.some((item) => item.endsWith('Fresh.otf')), true)
    assert.equal(isUnlinkedSource(paths, earlier), true)
    assert.equal(isUnlinkedSource(paths, fresh), true)
  })
})

test('a corrupt unlinked list with no valid bak resets on a manual add', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, '{')
    const blocked = path.join(paths.dataRoot, 'Blocked.otf')
    assert.equal(isUnlinkedSource(paths, blocked), true)
    const notices: string[] = []
    const stop = onEvent((event) => {
      if (event.type === 'notice') notices.push(event.notice.message)
    })
    try {
      allowUnlinkedSource(paths, blocked)
      const stored = JSON.parse(fs.readFileSync(target, 'utf8')) as { version: number; paths: string[] }
      assert.equal(stored.version, 1)
      assert.deepEqual(stored.paths, [])
      assert.equal(isUnlinkedSource(paths, blocked), false)
      assert.deepEqual(notices, [
        "Font Buttler couldn't read its list of unlinked fonts and started a new one. Fonts you unlinked earlier may reappear from watch folders. You can unlink them again.",
      ])
      assert.equal(takePendingUnlinkedListResetNotice(), null)
      allowUnlinkedSource(paths, blocked)
      assert.equal(notices.length, 1)
    } finally {
      stop()
      takePendingUnlinkedListResetNotice()
    }
  })
})

test('an EACCES read leaves the unlinked list untouched and skips auto-import', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const body = '{"version":1,"paths":["/kept/Font.otf"]}'
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, body)
    setUnlinkedListReadForTest((filePath) => {
      if (filePath === target) {
        const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
      return fs.readFileSync(filePath, 'utf8')
    })
    try {
      const blocked = path.join(paths.dataRoot, 'Blocked.otf')
      assert.equal(isUnlinkedSource(paths, blocked), true)
      allowUnlinkedSource(paths, blocked)
      assert.throws(() => rememberUnlinkedSource(paths, blocked), /may come back from a watch folder/)
      assert.equal(fs.readFileSync(target, 'utf8'), body)
      assert.equal(fs.existsSync(`${target}.bak`), false)
      assert.equal(isUnlinkedSource(paths, blocked), true)
    } finally {
      setUnlinkedListReadForTest(undefined)
    }
  })
})

test('a corrupt unlinked list stays unread when the backup cannot be read', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const bak = `${target}.bak`
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, '{')
    fs.writeFileSync(bak, 'kept-backup')
    setUnlinkedListReadForTest((filePath) => {
      if (filePath === bak) {
        const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
      return fs.readFileSync(filePath, 'utf8')
    })
    try {
      const blocked = path.join(paths.dataRoot, 'Blocked.otf')
      assert.equal(isUnlinkedSource(paths, blocked), true)
      allowUnlinkedSource(paths, blocked)
      assert.equal(fs.readFileSync(target, 'utf8'), '{')
      assert.equal(fs.readFileSync(bak, 'utf8'), 'kept-backup')
      assert.equal(isUnlinkedSource(paths, blocked), true)
    } finally {
      setUnlinkedListReadForTest(undefined)
    }
  })
})

test('a failed unlinked-list reset does not throw and leaves auto-import skipped', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const logFile = path.join(paths.dataRoot, 'reset.log')
    const previousLog = process.env.FONT_BUTLER_LOG
    process.env.FONT_BUTLER_LOG = logFile
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, '{')
    setUnlinkedListSaveFaultForTest(() => {
      throw new Error('no space left on device')
    })
    try {
      const blocked = path.join(paths.dataRoot, 'Blocked.otf')
      allowUnlinkedSource(paths, blocked)
      assert.equal(fs.readFileSync(target, 'utf8'), '{')
      assert.equal(isUnlinkedSource(paths, blocked), true)
      assert.match(
        fs.readFileSync(logFile, 'utf8'),
        /could not reset unlinked-sources.json: no space left on device/,
      )
    } finally {
      setUnlinkedListSaveFaultForTest(undefined)
      if (previousLog === undefined) delete process.env.FONT_BUTLER_LOG
      else process.env.FONT_BUTLER_LOG = previousLog
    }
  })
})

test('timestamped unlinked backups keep the newest three', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(`${target}.bak`, JSON.stringify({ version: 1, paths: [] }))
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(target, `{bad ${index}`)
      rememberUnlinkedSource(paths, path.join(paths.dataRoot, `Font${index}.otf`))
    }
    const stamped = fs
      .readdirSync(paths.dataRoot)
      .filter(
        (name) =>
          name.startsWith('unlinked-sources.json.') &&
          name.endsWith('.bak') &&
          name !== 'unlinked-sources.json.bak',
      )
    assert.equal(stamped.length, 3)
    const kept = JSON.parse(fs.readFileSync(`${target}.bak`, 'utf8')) as { version: number }
    assert.equal(kept.version, 1)
  })
})

test('a failed unlinked-list backup rename is logged and does not throw', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const logFile = path.join(paths.dataRoot, 'main.log')
    const previousLog = process.env.FONT_BUTLER_LOG
    process.env.FONT_BUTLER_LOG = logFile
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, '{')
    setUnlinkedBackupRenameForTest(() => {
      throw new Error('backup rename failed')
    })
    try {
      const fresh = path.join(paths.dataRoot, 'Fresh.otf')
      rememberUnlinkedSource(paths, fresh)
      assert.equal(isUnlinkedSource(paths, fresh), true)
      const stored = JSON.parse(fs.readFileSync(target, 'utf8')) as { version: number }
      assert.equal(stored.version, 1)
      assert.match(
        fs.readFileSync(logFile, 'utf8'),
        /could not back up unlinked-sources.json: backup rename failed\. The corrupt file was overwritten with a new list\./,
      )
    } finally {
      setUnlinkedBackupRenameForTest(undefined)
      if (previousLog === undefined) delete process.env.FONT_BUTLER_LOG
      else process.env.FONT_BUTLER_LOG = previousLog
    }
  })
})

test('a readable unlinked-sources file is replaced without a bak', () => {
  withTemp((paths) => {
    const first = path.join(paths.dataRoot, 'First.otf')
    const second = path.join(paths.dataRoot, 'Second.otf')
    rememberUnlinkedSource(paths, first)
    rememberUnlinkedSource(paths, second)
    assert.equal(fs.existsSync(`${listFile(paths)}.bak`), false)
    assert.equal(isUnlinkedSource(paths, first), true)
    assert.equal(isUnlinkedSource(paths, second), true)
  })
})
