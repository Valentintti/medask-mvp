import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const staticDemo = process.env.VITE_STATIC_DEMO === 'true'

export default defineConfig({
  base: staticDemo ? '/medask-mvp/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setupTests.ts',
    css: true,
    exclude: ['tests/**', 'node_modules/**', 'dist/**', 'dist-server/**'],
  },
})
