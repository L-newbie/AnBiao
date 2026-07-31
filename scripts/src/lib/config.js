// Central runtime config. Values are injected at build time via Vite env vars.
// In local dev they fall back to placeholders so the app still boots.

const env = import.meta.env

export const config = {
  // GitHub repo that holds BOTH the app (main branch) and the data (data branch).
  owner: env.VITE_GH_OWNER || 'your-github-username',
  repo: env.VITE_GH_REPO || 'geo-collector',
  dataBranch: env.VITE_DATA_BRANCH || 'data',
  // Fine-grained PAT, build-time injected, scoped to write the data branch only.
  // In the deployed artifact this token is visible to anyone — see plan's risk list.
  token: env.VITE_DATA_TOKEN || '',
  // Build-time-only URL of the aggregated data.json served by GitHub Pages.
  dataUrl: (env.BASE_URL || '/') + 'data.json',
  reportThreshold: 3,
  maxUploadsPerDay: 2,
  maxImageEdge: 1600,
  jpegQuality: 0.8,
  // AMap (高德) JS API — map display, reverse geocoding, geolocation.
  // Both are baked into the deployed bundle (same exposure class as the data
  // token). Mitigate with a Referer whitelist in the AMap console.
  amapKey: env.VITE_AMAP_KEY || '',
  amapSecret: env.VITE_AMAP_SECRET || '',
}

export const hasWriteToken = () => Boolean(config.token)
