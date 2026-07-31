import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages serves the site at /<repo>/, so the asset base must match.
// For a custom domain or user/org root, set VITE_BASE_URL to '/'.
const repo = process.env.VITE_REPO_NAME || ''
export default defineConfig({
  base: process.env.VITE_BASE_URL || (repo ? `/${repo}/` : '/'),
  plugins: [vue()],
})
