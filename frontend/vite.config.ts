import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills({ globals: { process: true, Buffer: true, global: true } })],
  define: { process: { env: {} } },
  build: { target: 'es2022' },
})
