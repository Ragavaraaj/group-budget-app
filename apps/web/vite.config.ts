import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Same-origin in every environment: Vite (dev) and `vite preview` proxy /api to `wrangler dev`,
// and in production one Worker serves the API and these static files. No CORS, and session
// cookies just work.
const api = { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The user decides when to reload into a new version; we never swap code mid-entry.
      registerType: 'prompt',
      injectRegister: false, // registered explicitly in src/pwa/register.ts
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Group Budget',
        short_name: 'Budget',
        description: 'Track personal and shared expenses, even offline.',
        lang: 'en-IN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Single-page app: any navigation is answered by the precached shell, except the API.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true, proxy: api },
  preview: { port: 4173, strictPort: true, proxy: api },
});
