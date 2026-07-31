// Image helpers: canvas downscaling + human-readable size. No external deps.
// (Geocoding moved to src/lib/amap.js — 高德 reverse geocoding.)

// Downscale an image File to a JPEG whose longest edge <= maxEdge.
// Returns { base64, blob, width, height }.
export function compressImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      const scale = Math.min(1, maxEdge / Math.max(width, height))
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const base64 = dataUrl.split(',')[1]
      canvas.toBlob(
        (blob) => resolve({ base64, blob, width, height }),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => reject(new Error('无法读取该图片'))
    img.src = URL.createObjectURL(file)
  })
}

// Bytes -> human readable, for showing upload size.
export function prettyBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
