import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills({ globals: { process: true, Buffer: true, global: true } })],
  define: {
    process: { env: {} },
    ...(process.env.VERCEL_ENV ? { 'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV) } : {}),
  },
  build: { target: 'es2022' },
})
