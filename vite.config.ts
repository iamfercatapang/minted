/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo>/; override with VITE_BASE for other hosts (Capacitor uses './').
const base = process.env.VITE_BASE ?? '/minted/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Minted',
        short_name: 'Minted',
        description: 'Household finance tracker and wealth goals. Track & grow.',
        theme_color: '#0F1B33',
        background_color: '#0F1B33',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        // Never cache Google API calls; the app keeps its own offline copy.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  test: { environment: 'node' },
});
