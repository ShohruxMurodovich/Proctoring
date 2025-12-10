import { fileURLToPath, URL } from 'node:url'
import { webcrypto } from 'node:crypto'

// Polyfill for environments where crypto.getRandomValues is missing
if (!globalThis.crypto?.getRandomValues) {
  globalThis.crypto = webcrypto as any
}

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
