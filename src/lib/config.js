// Central runtime config. Non-secret values are written directly here.
// The write token (VITE_DATA_TOKEN) is injected at build time ONLY — it must
// NEVER be committed to source, because GitHub secret scanning auto-revokes
// any PAT that appears in a public repo. Keep it in GitHub Actions Secrets.

const env = import.meta.env

export const config = {
  // GitHub repo that holds BOTH the app (master branch) and the data (data branch).
  owner: env.VITE_GH_OWNER || 'L-newbie',
  repo: env.VITE_GH_REPO || 'AnBiao',
  dataBranch: env.VITE_DATA_BRANCH || 'data',
  // Fine-grained PAT, build-time injected from Actions Secrets (VITE_DATA_TOKEN).
  // Deliberately not committed here. In the deployed bundle it is still visible
  // to site visitors, but it is NOT in the repo/source, so it is not auto-revoked.
  token: env.VITE_DATA_TOKEN || '',
  // Build-time-only URL of the aggregated data.json served by GitHub Pages.
  dataUrl: (env.BASE_URL || '/') + 'data.json',
  maxUploadsPerDay: 2,
  maxImageEdge: 1600,
  jpegQuality: 0.8,
  // AMap (高德) JS API — map display, reverse geocoding, geolocation.
  // Build-time injected from Actions Secrets to keep them out of source.
  amapKey: env.VITE_AMAP_KEY || '',
  amapSecret: env.VITE_AMAP_SECRET || '',
  // Comments: per-device daily cap and single-comment length cap.
  maxCommentsPerDay: 5,
  maxCommentLength: 100,
}

export const hasWriteToken = () => Boolean(config.token)
