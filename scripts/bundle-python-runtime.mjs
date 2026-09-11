import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PYTHON_RELEASE = '20260901'
const PYTHON_VERSION = '3.13.15'
const BUNDLE_REVISION = '3'
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = path.join(project, 'vendor')
const destDir = path.join(vendorDir, 'python')
const cacheDir = path.join(vendorDir, 'cache')
const requirementsPath = path.join(project, 'scripts/fonttools-requirements.txt')
const pythonScripts = ['rename_family.py', 'materialise_feature.py', '_remove_ot_features.py']
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

function copyPythonScripts() {
  fs.mkdirSync(destDir, { recursive: true })
  for (const name of pythonScripts) {
    fs.copyFileSync(path.join(project, 'scripts', name), path.join(destDir, name))
  }
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

function walkAndRemove(root, predicate) {
  if (!fs.existsSync(root)) return
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (predicate(full, entry)) {
        fs.rmSync(full, { recursive: true, force: true })
      } else {
        walkAndRemove(full, predicate)
      }
    } else if (predicate(full, entry)) {
      fs.rmSync(full, { force: true })
    }
  }
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
    'xmlrpc',
    'wsgiref',
    '_pyrepl',
    'turtle.py',
    'pydoc.py',
    'doctest.py',
    'this.py',
    'antigravity.py',
    'cgi.py',
    'cgitb.py',
  ]) {
    fs.rmSync(path.join(pyDir, extra), { recursive: true, force: true })
  }
  for (const name of fs.readdirSync(pyDir)) {
    if (name.startsWith('config-')) {
      fs.rmSync(path.join(pyDir, name), { recursive: true, force: true })
    }
  }
  const dynload = path.join(pyDir, 'lib-dynload')
  if (fs.existsSync(dynload)) {
    for (const name of fs.readdirSync(dynload)) {
      if (/^(_tkinter|_dbm|_sqlite3|_lsprof|_curses)/.test(name)) {
        fs.rmSync(path.join(dynload, name), { force: true })
      }
    }
  }
  const site = path.join(pyDir, 'site-packages')
  if (fs.existsSync(site)) {
    fs.rmSync(path.join(site, 'pip'), { recursive: true, force: true })
    for (const name of fs.readdirSync(site)) {
      if (name.startsWith('pip-') && name.endsWith('.dist-info')) {
        fs.rmSync(path.join(site, name), { recursive: true, force: true })
      }
    }
    const fontTools = path.join(site, 'fontTools')
    if (fs.existsSync(fontTools)) {
      for (const extra of [
        'cu2qu',
        'qu2cu',
        'ufoLib',
        'voltLib',
        'mtiLib',
        't1Lib',
        'svgLib',
        'diff',
        'merge',
        'fontBuilder.py',
        'help.py',
        'ttx.py',
        'afmLib.py',
        'tfmLib.py',
      ]) {
        fs.rmSync(path.join(fontTools, extra), { recursive: true, force: true })
      }
    }
  }
  for (const name of fs.readdirSync(path.join(destDir, 'bin'))) {
    if (
      name.startsWith('pip') ||
      name.startsWith('idle') ||
      name.startsWith('pydoc') ||
      name.endsWith('-config') ||
      name === 'fonttools' ||
      name === 'pyftmerge' ||
      name === 'pyftsubset' ||
      name === 'ttx'
    ) {
      fs.rmSync(path.join(destDir, 'bin', name), { force: true })
    }
  }
  walkAndRemove(destDir, (_full, entry) => entry.name === '__pycache__' || entry.name.endsWith('.pyc'))
}

if (alreadyBundled()) {
  copyPythonScripts()
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
  copyPythonScripts()
  fs.writeFileSync(markerPath, bundleId())
  console.log(`[font-butler] bundled Python + fonttools at ${destDir}`)
}
