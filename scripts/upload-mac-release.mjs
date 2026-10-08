import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNotarizedMacRelease, prepareMacPublish, readPackVersion } from './assert-notarized-mac-release.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MAC_RELEASE_NOTES = `This build is signed with Developer ID and notarized by Apple.

If you are using an earlier Font Buttler build, download this version manually once and replace the app. Those builds were ad-hoc signed. The in-app update check compares versions and opens the download in your browser. It does not install the update. Later releases still install the same way: download the file yourself.`

export function missingTagMessage(tag) {
  return `Tag ${tag} is not on origin. Create it from the release commit and push it before publishing:\n  git tag ${tag}\n  git push origin ${tag}`
}

/**
 * Create a draft when the GitHub Release is missing, upload, then mark it
 * public only after the upload succeeds. /releases/latest skips drafts, so a
 * failed upload cannot advertise a release that has no DMG.
 */
export async function publishVersionedMacRelease({ tag, files, release, tagOnRemote, exec }) {
  if (!tagOnRemote) {
    return { ok: false, error: missingTagMessage(tag), commands: [] }
  }
  const commands = []
  const createdDraft = !release?.exists
  if (createdDraft) {
    const createArgs = ['release', 'create', tag, '--verify-tag', '--draft', '--title', tag, '--notes', MAC_RELEASE_NOTES]
    const created = await exec('gh', createArgs)
    commands.push(['gh', ...createArgs])
    if ((created?.status ?? 1) !== 0) {
      return {
        ok: false,
        error: `Could not create draft release ${tag}. ${(created?.output || '').trim()}`.trim(),
        commands,
      }
    }
  }
  const uploadArgs = ['release', 'upload', tag, ...files, '--clobber']
  const uploaded = await exec('gh', uploadArgs)
  commands.push(['gh', ...uploadArgs])
  if ((uploaded?.status ?? 1) !== 0) {
    const stayed =
      createdDraft || release?.draft
        ? 'The release stays a draft so /releases/latest does not show a release without a DMG.'
        : `The existing ${tag} release was left unchanged.`
    return { ok: false, error: `Upload to ${tag} failed. ${stayed}`, commands }
  }
  if (createdDraft || release?.draft) {
    const editArgs = ['release', 'edit', tag, '--draft=false']
    const edited = await exec('gh', editArgs)
    commands.push(['gh', ...editArgs])
    if ((edited?.status ?? 1) !== 0) {
      return {
        ok: false,
        error: `Uploaded ${tag}, but publishing the draft failed. It is still a draft.`,
        commands,
      }
    }
  }
  return { ok: true, commands }
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
  const notarized = assertNotarizedMacRelease(repoRoot, version)
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
  const published = await publishVersionedMacRelease({
    tag,
    files: prepared.upload,
    release,
    tagOnRemote: remote.present,
    exec: async (_command, args) => spawnGh(args),
  })
  if (!published.ok) {
    console.error(published.error)
    process.exit(1)
  }
  console.log(`Published ${tag} with ${prepared.expected.dmg} and ${prepared.expected.zip}.`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main()
}
