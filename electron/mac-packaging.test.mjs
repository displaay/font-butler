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

test('tag release workflow packages on macOS and publishes the updater feed', () => {
  const workflow = readRepo('.github/workflows/release.yml')
  const ci = readRepo('.github/workflows/ci.yml')
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/)
  assert.match(workflow, /runs-on: macos-latest/)
  assert.match(workflow, /npm run dist/)
  assert.match(workflow, /softprops\/action-gh-release@v2/)
  assert.match(workflow, /latest-mac\.yml/)
  assert.match(workflow, /draft: false/)
  assert.match(workflow, /prerelease: false/)
  assert.doesNotMatch(workflow, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(ci, /github\.ref_type != 'tag'/)
})

test('ad-hoc entitlements keep Electron runnable without a Developer ID', () => {
  const entitlements = readRepo('build/entitlements.mac.plist')
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/)
})
