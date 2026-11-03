/**
 * Announcement popup host: dark-glass BrowserWindow, announcements.json state,
 * and canvas confetti on dismiss (no new dependency).
 */

import { BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  ANNOUNCEMENTS,
  markAnnouncementSeen,
  nextAnnouncementToShow,
  parseAnnouncementState,
} from './announcements-gate.mjs'

/** @type {BrowserWindow | null} */
let announcementWindow = null

export const ANNOUNCEMENTS_FILE = 'announcements.json'
export const ANNOUNCEMENT_WINDOW_KIND = 'announcement'

export {
  ANNOUNCEMENTS,
  markAnnouncementSeen,
  nextAnnouncementToShow,
  parseAnnouncementState,
} from './announcements-gate.mjs'

export function announcementsFilePath(userDataDir) {
  return path.join(userDataDir, ANNOUNCEMENTS_FILE)
}

export function libraryLooksEstablished(userDataDir) {
  if (!userDataDir) return false
  for (const name of ['catalog.json', 'settings.json']) {
    try {
      if (fs.existsSync(path.join(userDataDir, name))) return true
    } catch {
      // Ignore unreadable probes; treat as not established.
    }
  }
  return false
}

export function readAnnouncementStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function writeAnnouncementStateFile(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(tmp, filePath)
}

export function announcementPopupHtml(announcement) {
  const title = escapeHtml(announcement?.title ?? '')
  const body = escapeHtml(announcement?.body ?? '')
  const celebrate = announcement?.celebrate === true
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      --glass-bg: rgba(18, 18, 22, 0.72);
      --glass-border: rgba(255, 255, 255, 0.12);
      --text: rgba(255, 255, 255, 0.92);
      --muted: rgba(255, 255, 255, 0.68);
      --accent: #f2f2f2;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      -webkit-user-select: none;
      user-select: none;
    }
    body {
      display: grid;
      place-items: center;
      padding: 18px;
    }
    .panel {
      width: min(100%, 420px);
      padding: 28px 28px 22px;
      border-radius: 22px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(28px) saturate(1.2);
      -webkit-backdrop-filter: blur(28px) saturate(1.2);
      color: var(--text);
      text-align: left;
      position: relative;
      z-index: 1;
    }
    .brand {
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 14px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 22px;
      font-size: 15px;
      line-height: 1.45;
      color: var(--muted);
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 10px 18px;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      background: var(--accent);
      color: #111;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 3px;
    }
    canvas {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    }
  </style>
</head>
<body>
  <div class="panel" role="dialog" aria-labelledby="announcement-title">
    <div class="brand">Cuttler</div>
    <h1 id="announcement-title">${title}</h1>
    <p>${body}</p>
    <button type="button" id="ok">Got it</button>
  </div>
  <canvas id="confetti" width="1" height="1" hidden></canvas>
  <script>
    const celebrate = ${celebrate ? 'true' : 'false'}
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const button = document.getElementById('ok')
    const canvas = document.getElementById('confetti')
    let closing = false

    function closeAnnouncement() {
      if (closing) return
      closing = true
      if (window.fontButlerAnnouncement?.dismiss) {
        window.fontButlerAnnouncement.dismiss()
      }
    }

    function burstConfetti(done) {
      if (!celebrate || reduced) {
        done()
        return
      }
      canvas.hidden = false
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const resize = () => {
        canvas.width = Math.floor(window.innerWidth * dpr)
        canvas.height = Math.floor(window.innerHeight * dpr)
        canvas.style.width = window.innerWidth + 'px'
        canvas.style.height = window.innerHeight + 'px'
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      resize()
      const colors = ['#ffffff', '#d9d9de', '#8ad7ff', '#ffd29a', '#c7b6ff']
      const pieces = Array.from({ length: 90 }, () => ({
        x: Math.random() * window.innerWidth,
        y: -20 - Math.random() * window.innerHeight * 0.35,
        w: 4 + Math.random() * 6,
        h: 6 + Math.random() * 8,
        vx: -2 + Math.random() * 4,
        vy: 2 + Math.random() * 3.5,
        rot: Math.random() * Math.PI,
        vr: -0.2 + Math.random() * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)],
      }))
      const started = performance.now()
      function frame(now) {
        const elapsed = now - started
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
        for (const piece of pieces) {
          piece.x += piece.vx
          piece.y += piece.vy
          piece.vy += 0.04
          piece.rot += piece.vr
          ctx.save()
          ctx.translate(piece.x, piece.y)
          ctx.rotate(piece.rot)
          ctx.fillStyle = piece.color
          ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h)
          ctx.restore()
        }
        if (elapsed < 900) requestAnimationFrame(frame)
        else done()
      }
      requestAnimationFrame(frame)
    }

    button.addEventListener('click', () => {
      button.disabled = true
      burstConfetti(closeAnnouncement)
    })
  </script>
</body>
</html>`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function planAnnouncementPopup({ userDataDir, currentVersion }) {
  const filePath = announcementsFilePath(userDataDir)
  const raw = readAnnouncementStateFile(filePath)
  const libraryEstablished = libraryLooksEstablished(userDataDir)
  const planned = nextAnnouncementToShow({
    state: raw,
    currentVersion,
    libraryEstablished,
  })
  if (planned.seedSeen) {
    writeAnnouncementStateFile(filePath, planned.state)
  }
  return { ...planned, filePath }
}

export function showAnnouncementWindow({
  announcement,
  dirname,
  onDismiss,
  BrowserWindowImpl = BrowserWindow,
}) {
  if (!announcement) return null
  if (announcementWindow && !announcementWindow.isDestroyed()) {
    announcementWindow.focus()
    return announcementWindow
  }
  announcementWindow = new BrowserWindowImpl({
    width: 460,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: announcement.title,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(dirname, 'announcement-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  announcementWindow.announcementWindowKind = ANNOUNCEMENT_WINDOW_KIND
  const html = announcementPopupHtml(announcement)
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  void announcementWindow.loadURL(dataUrl)
  announcementWindow.once('ready-to-show', () => {
    if (!announcementWindow || announcementWindow.isDestroyed()) return
    announcementWindow.show()
    announcementWindow.focus()
  })
  announcementWindow.on('closed', () => {
    announcementWindow = null
  })
  const dismiss = () => {
    if (typeof onDismiss === 'function') onDismiss(announcement)
    if (announcementWindow && !announcementWindow.isDestroyed()) {
      announcementWindow.close()
    }
  }
  const handler = () => {
    ipcMain.removeListener('announcement:dismiss', handler)
    dismiss()
  }
  ipcMain.once('announcement:dismiss', handler)
  announcementWindow.on('closed', () => {
    ipcMain.removeListener('announcement:dismiss', handler)
  })
  return announcementWindow
}

export function presentPendingAnnouncement({ userDataDir, currentVersion, dirname, onShown }) {
  const planned = planAnnouncementPopup({ userDataDir, currentVersion })
  if (!planned.announcement) return null
  const { filePath, state, announcement } = planned
  showAnnouncementWindow({
    announcement,
    dirname,
    onDismiss: () => {
      writeAnnouncementStateFile(filePath, markAnnouncementSeen(state, announcement.id))
    },
  })
  onShown?.(announcement)
  return announcement
}
