import { fileURLToPath, URL } from 'node:url'
import { webcrypto } from 'node:crypto'

// Polyfill for environments where crypto.getRandomValues is missing
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as typeof globalThis & { crypto: typeof webcrypto }).crypto = webcrypto
} else if (typeof globalThis.crypto.getRandomValues === 'undefined') {
  globalThis.crypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto)
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
