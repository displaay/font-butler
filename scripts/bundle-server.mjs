import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  root: project,
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: path.join(project, 'server/index.ts'),
    outDir: path.join(project, 'electron'),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'server.bundle.mjs',
      },
    },
  },
})
