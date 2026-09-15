// Diagnostic preload only. Keeps each test process alive until its after hooks run,
// exposing tests canceled by core/font-analysis.ts unref'ing an active worker.
import { after } from 'node:test'
const timer = setInterval(() => {}, 1000)
after(() => clearInterval(timer))
