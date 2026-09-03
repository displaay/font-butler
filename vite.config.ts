import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 43181,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:43182',
        changeOrigin: true,
      },
    },
  },
})
