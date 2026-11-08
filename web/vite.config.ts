import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, send /api calls to the Functions emulator.
// The function sees the same /api/... path as it does behind Firebase Hosting.
const functionsEmulator = 'http://127.0.0.1:5001/repair-cafe-dev/europe-west2/api'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: functionsEmulator,
        changeOrigin: true,
      },
    },
  },
})
