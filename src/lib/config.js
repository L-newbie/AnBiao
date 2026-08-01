// Central runtime config. Values are written directly into the bundle
// (intentionally — see the token exposure note below) rather than injected
// via Vite env vars, so the build does not depend on .env.local or Actions
// secrets being configured.

export const config = {
  // GitHub repo that holds BOTH the app (master branch) and the data (data branch).
  owner: 'L-newbie',
  repo: 'AnBiao',
  dataBranch: 'data',
  // Fine-grained PAT. WARNING: baked into the deployed bundle, so it is visible
  // to anyone who opens the site. Scoped to write the `data` branch of this one
  // repo only (Contents: read+write on L-newbie/AnBiao).
  token: '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',
  // Build-time-only URL of the aggregated data.json served by GitHub Pages.
  dataUrl: (import.meta.env.BASE_URL || '/') + 'data.json',
  reportThreshold: 3,
  maxUploadsPerDay: 2,
  maxImageEdge: 1600,
  jpegQuality: 0.8,
  // AMap (高德) JS API — map display, reverse geocoding, geolocation.
  // Both are baked into the deployed bundle (same exposure class as the data
  // token). Mitigate with a Referer whitelist in the AMap console.
  amapKey: 'f46549dbb1c38ae1d653675d7b71ec42',
  amapSecret: 'a00791977895243e05a890b97e514778',
}

export const hasWriteToken = () => Boolean(config.token)
