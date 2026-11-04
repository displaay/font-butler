import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKUP_LICENSE_WARNING, BACKUP_RESTORE_WARNING, formatBackupBytes } from '../lib/backup.ts'

test('backup UI copy states size and licensed font files', () => {
  assert.match(BACKUP_LICENSE_WARNING, /contains your font files/)
  assert.match(BACKUP_LICENSE_WARNING, /as large as your whole font library/)
  assert.match(BACKUP_LICENSE_WARNING, /licensed fonts/)
  assert.match(BACKUP_LICENSE_WARNING, /keep the file private/)
  assert.match(BACKUP_RESTORE_WARNING, /licensed fonts/)
})

test('formatBackupBytes renders archive sizes', () => {
  assert.equal(formatBackupBytes(512), '512 B')
  assert.equal(formatBackupBytes(2048), '2.0 KB')
  assert.equal(formatBackupBytes(5 * 1024 * 1024), '5.0 MB')
})
