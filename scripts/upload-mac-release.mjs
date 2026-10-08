import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNotarizedMacRelease, prepareMacPublish, readPackVersion } from './assert-notarized-mac-release.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MAC_RELEASE_NOTES = `This build is signed with Developer ID and notarized by Apple.

If you are using an earlier Font Buttler build, download this version manually once and replace the app. Those builds were ad-hoc signed. The in-app update check compares versions and opens the download in your browser. It does not install the update. Later releases still install the same way: download the file yourself.`

export function missingTagMessage(tag) {
  return `Tag ${tag} is not on origin. Create it from the release commit and push it before uploading:\n  git tag ${tag}\n  git push origin ${tag}`
}

export function publishedReleaseMessage(tag) {
  return `GitHub Release ${tag} is already published. Refusing to overwrite it.`
}

function uploadVerificationError(tag, files, view, { allowMissing = false } = {}) {
  if ((view?.status ?? 1) !== 0) return `Could not verify the draft upload for ${tag}.`
  let parsed
  try {
    parsed = JSON.parse(view.output ?? '')
  } catch {
    return `Could not read the assets on draft ${tag}.`
  }
  if (parsed.isDraft !== true) {
    return `Release ${tag} is not a draft after upload. This command does not publish it.`
  }
  const expectedNames = files.map((file) => path.basename(file))
  const expected = new Set(expectedNames)
  const present = new Set()
  const presentNames = []
  for (const asset of parsed.assets ?? []) {
    const name = asset?.name
    if (typeof name !== 'string' || name.length === 0 || present.has(name)) continue
    present.add(name)
    presentNames.push(name)
  }
  if (!allowMissing) {
    const missing = expectedNames.filter((name) => !present.has(name))
    if (missing.length) return `Draft ${tag} is missing ${missing.join(', ')} after upload.`
  }
  const extra = presentNames.filter((name) => !expected.has(name))
  if (extra.length) {
    return `Draft ${tag} has extra assets (${extra.join(', ')}). Remove them from the draft. This command does not delete assets.`
  }
  return null
}

/**
 * Create a draft when the GitHub Release is missing, upload the version-matched
 * files, and stop. Publishing (`gh release edit <tag> --draft=false`) is a
 * separate manual step. A release that is already public is left untouched.
 */
export async function publishVersionedMacRelease({ tag, files, release, tagOnRemote, exec }) {
  if (!tagOnRemote) {
    return { ok: false, draft: false, error: missingTagMessage(tag), commands: [] }
  }
  if (release?.exists && !release.draft) {
    return { ok: false, draft: false, error: publishedReleaseMessage(tag), commands: [] }
  }
  const ship = files.filter((file) => !path.basename(file).endsWith('.dmg.blockmap'))
  const commands = []
  if (release?.exists && release.draft) {
    const preflightArgs = ['release', 'view', tag, '--json', 'isDraft,assets']
    const preflight = await exec('gh', preflightArgs)
    commands.push(['gh', ...preflightArgs])
    const extraError = uploadVerificationError(tag, ship, preflight, { allowMissing: true })
    if (extraError) return { ok: false, draft: true, error: extraError, commands }
  }
  if (!release?.exists) {
    const createArgs = ['release', 'create', tag, '--verify-tag', '--draft', '--title', tag, '--notes', MAC_RELEASE_NOTES]
    const created = await exec('gh', createArgs)
    commands.push(['gh', ...createArgs])
    if ((created?.status ?? 1) !== 0) {
      return {
        ok: false,
        draft: false,
        error: `Could not create draft release ${tag}. ${(created?.output || '').trim()}`.trim(),
        commands,
      }
    }
  }
  const uploadArgs = ['release', 'upload', tag, ...ship, '--clobber']
  const uploaded = await exec('gh', uploadArgs)
  commands.push(['gh', ...uploadArgs])
  if ((uploaded?.status ?? 1) !== 0) {
    return {
      ok: false,
      draft: true,
      error: `Upload to ${tag} failed. The release stays a draft so /releases/latest does not show a release without a DMG.`,
      commands,
    }
  }
  const viewArgs = ['release', 'view', tag, '--json', 'isDraft,assets']
  const viewed = await exec('gh', viewArgs)
  commands.push(['gh', ...viewArgs])
  const verificationError = uploadVerificationError(tag, ship, viewed)
  if (verificationError) {
    return { ok: false, draft: true, error: verificationError, commands }
  }
  return { ok: true, draft: true, commands }
}

function spawnCaptured(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

function tagOnOrigin(tag) {
  const result = spawnCaptured('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (result.status !== 0) {
    return { error: `Could not check whether ${tag} is on origin. ${result.output.trim()}` }
  }
  return { present: result.output.trim().length > 0 }
}

function viewRelease(tag) {
  const result = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if ((result.status ?? 1) === 0) {
    const parsed = JSON.parse(result.stdout)
    return { exists: true, draft: parsed.isDraft === true }
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (/not found|404/i.test(output)) return { exists: false, draft: false }
  return { error: `Could not read GitHub Release ${tag}. ${output.trim()}` }
}

function spawnGh(args) {
  const result = spawnSync('gh', args, { cwd: repoRoot, stdio: 'inherit' })
  if (result.error) return { status: 1, output: result.error.message }
  return { status: result.status ?? 1, output: '' }
}

async function main() {
  const version = readPackVersion(repoRoot)
  const prepared = prepareMacPublish(repoRoot, version)
  if (prepared.failures.length) {
    console.error('Refusing to upload this macOS build.')
    for (const failure of prepared.failures) console.error(`- ${failure}`)
    process.exit(1)
  }
  const notarized = await assertNotarizedMacRelease(repoRoot, version)
  if (notarized.length) {
    console.error('Refusing to upload this macOS build.')
    for (const failure of notarized) console.error(`- ${failure}`)
    process.exit(1)
  }
  const tag = `v${version}`
  const remote = tagOnOrigin(tag)
  if (remote.error) {
    console.error(remote.error)
    process.exit(1)
  }
  const release = remote.present ? viewRelease(tag) : { exists: false, draft: false }
  if (release.error) {
    console.error(release.error)
    process.exit(1)
  }
  const uploaded = await publishVersionedMacRelease({
    tag,
    files: prepared.upload,
    release,
    tagOnRemote: remote.present,
    exec: async (_command, args) => {
      if (args[0] === 'release' && args[1] === 'view') {
        const result = spawnSync('gh', args, { cwd: repoRoot, encoding: 'utf8' })
        return { status: result.status ?? 1, output: result.stdout ?? '' }
      }
      return spawnGh(args)
    },
  })
  if (!uploaded.ok) {
    console.error(uploaded.error)
    process.exit(1)
  }
  console.log(`Uploaded ${prepared.expected.dmg} and ${prepared.expected.zip} to draft ${tag}. The release is still a draft.`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main()
}
