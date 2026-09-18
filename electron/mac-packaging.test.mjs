import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function readRepo(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('mac dist ad-hoc signs the app bundle and strips copyable xattrs', () => {
  const pkg = JSON.parse(readRepo('package.json'))
  assert.equal(pkg.build.mac.identity, '-')
  assert.equal(pkg.build.mac.entitlements, 'build/entitlements.mac.plist')
  assert.equal(pkg.build.mac.entitlementsInherit, 'build/entitlements.mac.plist')
  assert.equal(pkg.build.afterPack, './scripts/strip-mac-xattrs.mjs')
  assert.equal(pkg.build.afterAllArtifactBuild, './scripts/strip-mac-xattrs.mjs')
  assert.match(pkg.scripts.dist, /COPYFILE_DISABLE=1/)
  assert.match(pkg.scripts['bundle:python'], /COPYFILE_DISABLE=1/)
  assert.doesNotMatch(pkg.scripts.dist, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(readRepo('scripts/strip-mac-xattrs.mjs'), /compileFinderServicesAddon/)
})

test('ad-hoc entitlements keep Electron runnable without a Developer ID', () => {
  const entitlements = readRepo('build/entitlements.mac.plist')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/)
})
