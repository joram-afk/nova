import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// @ts-expect-error plain JS plugin
import { novaThemes } from './themes.plugin.mjs'

export default defineConfig({
  plugins: [
    novaThemes(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'NOVA COPILOT',
        short_name: 'NOVA',
        description: 'AI assistant for meetings and interviews',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
