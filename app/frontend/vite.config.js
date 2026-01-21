import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3778,
    proxy: {
      '/api': {
        target: 'http://localhost:3777',
        changeOrigin: true,
        // Configuração necessária para SSE (Server-Sent Events)
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // SSE precisa de conexão persistente
            if (req.url.includes('/events')) {
              proxyReq.setHeader('Connection', 'keep-alive')
              proxyReq.setHeader('Cache-Control', 'no-cache')
            }
          })
        }
      }
    }
  },
  build: {
    outDir: 'dist'
  }
})
