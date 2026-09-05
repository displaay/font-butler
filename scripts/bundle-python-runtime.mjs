import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PYTHON_RELEASE = '20260901'
const PYTHON_VERSION = '3.13.15'
const BUNDLE_REVISION = '2'
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = path.join(project, 'vendor')
const destDir = path.join(vendorDir, 'python')
const cacheDir = path.join(vendorDir, 'cache')
const requirementsPath = path.join(project, 'scripts/fonttools-requirements.txt')
const scriptPath = path.join(project, 'scripts/rename_family.py')
const markerPath = path.join(destDir, '.bundle-id')

function targetTriple() {
  const triples = {
    darwin: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' },
    linux: {
      arm64: 'aarch64-unknown-linux-gnu',
      x64: 'x86_64-unknown-linux-gnu',
    },
  }
  const triple = triples[process.platform]?.[process.arch]
  if (!triple) {
    throw new Error(
      `No bundled Python for ${process.platform}-${process.arch}. Package Font Buttler on macOS.`,
    )
  }
  return triple
}

function assetName() {
  return `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${targetTriple()}-install_only_stripped.tar.gz`
}

function bundleId() {
  const requirements = fs.readFileSync(requirementsPath, 'utf8').trim()
  return `${assetName()}\n${requirements}\n${BUNDLE_REVISION}\n`
}

function pythonBin() {
  return path.join(destDir, 'bin', 'python3')
}

function copyRenameScript() {
  fs.copyFileSync(scriptPath, path.join(destDir, 'rename_family.py'))
}

function alreadyBundled() {
  return (
    fs.existsSync(pythonBin()) &&
    fs.existsSync(markerPath) &&
    fs.readFileSync(markerPath, 'utf8') === bundleId()
  )
}

async function download(url, dest) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
}

function extract(archive) {
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(vendorDir, { recursive: true })
  execFileSync('tar', ['-xzf', archive, '-C', vendorDir], { stdio: 'inherit' })
  if (!fs.existsSync(pythonBin())) {
    throw new Error(`Extracted Python is missing ${pythonBin()}`)
  }
  if (process.platform === 'darwin') {
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', destDir], { stdio: 'ignore' })
  }
}

function installFonttools() {
  const python = pythonBin()
  try {
    execFileSync(python, ['-I', '-m', 'pip', '--version'], { stdio: 'ignore' })
  } catch {
    execFileSync(python, ['-I', '-m', 'ensurepip', '--upgrade'], { stdio: 'inherit' })
  }
  execFileSync(
    python,
    [
      '-I',
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-cache-dir',
      '-r',
      requirementsPath,
    ],
    { stdio: 'inherit' },
  )
}

function pruneRuntime() {
  for (const extra of ['include', 'share']) {
    fs.rmSync(path.join(destDir, extra), { recursive: true, force: true })
  }
  const libDir = path.join(destDir, 'lib')
  for (const name of fs.readdirSync(libDir)) {
    if (/^(tcl|tk|itcl|thread|libtcl|libtk)/.test(name)) {
      fs.rmSync(path.join(libDir, name), { recursive: true, force: true })
    }
  }
  const pyLib = fs.readdirSync(libDir).find((name) => name.startsWith('python3'))
  if (!pyLib) return
  const pyDir = path.join(libDir, pyLib)
  for (const extra of [
    'test',
    'idlelib',
    'tkinter',
    'turtledemo',
    'ensurepip',
    'pydoc_data',
    'unittest',
  ]) {
    fs.rmSync(path.join(pyDir, extra), { recursive: true, force: true })
  }
  const site = path.join(pyDir, 'site-packages')
  if (fs.existsSync(site)) {
    fs.rmSync(path.join(site, 'pip'), { recursive: true, force: true })
    for (const name of fs.readdirSync(site)) {
      if (name.startsWith('pip-') && name.endsWith('.dist-info')) {
        fs.rmSync(path.join(site, name), { recursive: true, force: true })
      }
    }
  }
  for (const name of fs.readdirSync(path.join(destDir, 'bin'))) {
    if (name.startsWith('pip') || name.startsWith('idle')) {
      fs.rmSync(path.join(destDir, 'bin', name), { force: true })
    }
  }
}

if (alreadyBundled()) {
  copyRenameScript()
  console.log(`[font-butler] bundled Python is current (${assetName()})`)
} else {
  fs.mkdirSync(cacheDir, { recursive: true })
  const archive = path.join(cacheDir, assetName())
  if (!fs.existsSync(archive)) {
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${assetName()}`
    console.log(`[font-butler] downloading ${url}`)
    await download(url, archive)
  }
  extract(archive)
  installFonttools()
  pruneRuntime()
  copyRenameScript()
  fs.writeFileSync(markerPath, bundleId())
  console.log(`[font-butler] bundled Python + fonttools at ${destDir}`)
}
