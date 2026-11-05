import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const MONTH = 60 * 60 * 24 * 30;

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    cssMinify: true,
    // maplibre-gl is ~800 KB; it lives in its own long-cached chunk.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunk: app updates don't re-download the map engine.
        manualChunks: (id: string) => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined),
      },
    },
  },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'Bản đồ ngập lụt Việt Nam',
        short_name: 'Ngập lụt VN',
        description: 'Xem vùng ngập và được dẫn đường tới nơi an toàn gần nhất.',
        lang: 'vi',
        theme_color: '#0b3d91',
        background_color: '#0b1d33',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Vector tiles, style, fonts, sprites – usable offline once viewed.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'basemap',
              expiration: { maxEntries: 4000, maxAgeSeconds: MONTH },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dem',
              expiration: { maxEntries: 1500, maxAgeSeconds: MONTH * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/data\/flood\/.*\.geojson$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'flood-data', expiration: { maxEntries: 50 } },
          },
        ],
      },
    }),
  ],
});
