import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind mounts on Windows don't forward file events into the container, so poll there.
    watch: { usePolling: process.env.VITE_POLLING === 'true' },
    proxy: {
      '/api': process.env.API_TARGET || 'http://localhost:4000',
    },
  },
})
