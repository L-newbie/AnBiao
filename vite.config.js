import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site at /<repo>/, so the asset base must match.
// For a custom domain or user/org root, set VITE_BASE_URL to '/'.
const repo = process.env.VITE_REPO_NAME || ''
export default defineConfig({
  base: process.env.VITE_BASE_URL || (repo ? `/${repo}/` : '/'),
  plugins: [
    vue(),
    // PWA: makes the site a real "Add to Home Screen" app with auto-update.
    // registerType 'autoUpdate' makes the new SW skipWaiting + clients.claim;
    // src/lib/usePwaUpdate.js adds the iOS-foreground re-check on top of that.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // manual register in main.js → we get the updateSW handle
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: '暗标 AnBiao',
        short_name: '暗标',
        description: '匿名投放、路过即见——一张图一个坐标的公益记录',
        theme_color: '#f0f6fb',
        background_color: '#f0f6fb',
        display: 'standalone',
        orientation: 'portrait',
        // start_url / scope intentionally omitted: the plugin derives both
        // from `base` (=/AnBiao/), which is the most broadly compatible form.
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // SPA shell: deep links fall back to index.html.
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
        // data.json is the live feed — never precache it. github.js already
        // fetches it with cache:'no-store'; this is defensive belt-and-suspenders.
        globIgnores: ['**/data.json'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // images/ are written by scripts/aggregate.js AFTER `vite build`
            // (npm script: "vite build && node scripts/aggregate.js"), so the PWA
            // plugin's precache scan never sees them. Cache them on first view so
            // they're available offline thereafter. data.json doesn't match this
            // rule and stays passthrough → always fresh.
            urlPattern: /\/images\/.*\.(?:png|jpe?g|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'anbiao-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
})
