import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertNotarizedMacRelease,
  prepareMacPublish,
  readPackVersion,
  releaseAssetVersion,
} from './assert-notarized-mac-release.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MAC_RELEASE_NOTES = `This build is signed with Developer ID and notarized by Apple.

If you are on Font Buttler 0.3.8 or earlier, download this version manually once and replace the app. Those builds were ad-hoc signed, and their Update badge does not install. After this signed version is the one you run, later releases install from the Update badge next to Settings.

Reinstalling a font in ~/Library/Fonts no longer clears the macOS font cache, so Figma and other apps keep seeing your fonts after an automatic reinstall. The file is replaced in place for macOS to pick up, and a reinstall counts as done only after a fresh check finds the font (#61).

Clear font caches is now a manual action in Settings. It asks first, because user fonts will not activate until you log out, then offers Log out now or Later (#61).

If Log out now fails, Font Buttler shows a dialog with the error instead of doing nothing (#61).`

export function missingTagMessage(tag) {
  return `Tag ${tag} is not on origin. Create it from the release commit and push it before uploading:\n  git tag ${tag}\n  git push origin ${tag}`
}

export function publishedReleaseMessage(tag) {
  return `GitHub Release ${tag} is already published. Refusing to overwrite it.`
}

export function shaFromLsRemote(output) {
  const line = String(output ?? '')
    .split('\n')
    .map((row) => row.trim())
    .find(Boolean)
  if (!line) return null
  const sha = line.split(/\s+/)[0]?.toLowerCase()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}

/** Peeled `refs/tags/<tag>^{}` is the commit for an annotated tag. A lightweight tag has no peel, so use the tag ref. */
export function remoteTagCommitSha(peeledOutput, tagOutput) {
  return shaFromLsRemote(peeledOutput) ?? shaFromLsRemote(tagOutput)
}

export function tagCommitMismatchMessage(tag, head, remoteSha) {
  return `Tag ${tag} on origin points at ${remoteSha}, but HEAD is ${head}. Refusing to upload. The draft was not changed.`
}

export function dirtyWorktreeMessage(tag, head, remoteSha) {
  return `Tag ${tag} on origin points at ${remoteSha} and HEAD is ${head}, but the working tree has modified tracked files or untracked files that are not ignored. Refusing to upload. The draft was not changed.`
}

export function expectedReleaseTag(version) {
  return `v${version}`
}

export function tagNameMismatchMessage(tag, version) {
  const expected = expectedReleaseTag(version)
  return `Tag ${tag} does not match package.json version ${version}. The tag must be ${expected}. Refusing to upload. The draft was not changed.`
}

/** `git status --porcelain` lists modified tracked files and untracked files that are not ignored. */
export function worktreeDirty(porcelain) {
  return String(porcelain ?? '')
    .split('\n')
    .some((line) => line.trim().length > 0)
}

export function remoteTagLsRemoteArgs(tag) {
  return [
    ['ls-remote', 'origin', `refs/tags/${tag}^{}`],
    ['ls-remote', 'origin', `refs/tags/${tag}`],
  ]
}

export function releaseCommitGuard({ tag, version, head, remoteSha, dirty = false }) {
  if (version !== undefined && tag !== expectedReleaseTag(version)) {
    return { ok: false, error: tagNameMismatchMessage(tag, version) }
  }
  const remote = remoteSha ? String(remoteSha).toLowerCase() : null
  const local = head ? String(head).toLowerCase() : null
  if (!remote) return { ok: false, error: missingTagMessage(tag) }
  if (local !== remote) return { ok: false, error: tagCommitMismatchMessage(tag, local, remote) }
  if (dirty) return { ok: false, error: dirtyWorktreeMessage(tag, local, remote) }
  return { ok: true, remoteSha: remote, head: local }
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
export async function publishVersionedMacRelease({
  tag,
  files,
  release,
  tagOnRemote,
  exec,
  version,
  head,
  remoteSha,
  dirty = false,
}) {
  if (version !== undefined || head !== undefined || remoteSha !== undefined || dirty) {
    const guard = releaseCommitGuard({ tag, version, head, remoteSha, dirty })
    if (!guard.ok) return { ok: false, draft: false, error: guard.error, commands: [] }
  } else if (!tagOnRemote) {
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

function remoteTagCommit(tag) {
  const [peeledArgs, tagArgs] = remoteTagLsRemoteArgs(tag)
  const peeled = spawnCaptured('git', peeledArgs)
  if (peeled.status !== 0) {
    return { error: `Could not read ${peeledArgs[2]} on origin. ${peeled.output.trim()}` }
  }
  const peeledSha = shaFromLsRemote(peeled.output)
  if (peeledSha) return { sha: peeledSha }
  const lightweight = spawnCaptured('git', tagArgs)
  if (lightweight.status !== 0) {
    return { error: `Could not read ${tagArgs[2]} on origin. ${lightweight.output.trim()}` }
  }
  return { sha: shaFromLsRemote(lightweight.output) }
}

function localHeadCommit() {
  const result = spawnCaptured('git', ['rev-parse', 'HEAD'])
  if (result.status !== 0) return { error: `Could not read HEAD. ${result.output.trim()}` }
  const sha = shaFromLsRemote(result.output)
  if (!sha) return { error: 'Could not read HEAD.' }
  return { sha }
}

function worktreeStatus() {
  const result = spawnCaptured('git', ['status', '--porcelain'])
  if (result.status !== 0) return { error: `Could not read the working tree. ${result.output.trim()}` }
  return { dirty: worktreeDirty(result.output) }
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
  const version = releaseAssetVersion(readPackVersion(repoRoot))
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
  const tag = expectedReleaseTag(version)
  const remote = remoteTagCommit(tag)
  if (remote.error) {
    console.error(remote.error)
    process.exit(1)
  }
  const head = localHeadCommit()
  if (head.error) {
    console.error(head.error)
    process.exit(1)
  }
  const tree = worktreeStatus()
  if (tree.error) {
    console.error(tree.error)
    process.exit(1)
  }
  const guard = releaseCommitGuard({ tag, version, head: head.sha, remoteSha: remote.sha, dirty: tree.dirty })
  if (!guard.ok) {
    console.error(guard.error)
    process.exit(1)
  }
  const release = viewRelease(tag)
  if (release.error) {
    console.error(release.error)
    process.exit(1)
  }
  const uploaded = await publishVersionedMacRelease({
    tag,
    files: prepared.upload,
    release,
    tagOnRemote: true,
    version,
    head: head.sha,
    remoteSha: remote.sha,
    dirty: tree.dirty,
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
