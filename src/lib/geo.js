// Image helpers (canvas downscaling + human-readable size) plus small
// geo math (haversine distance / distance formatting) for the map tab and
// 附近 mode. No external deps.
// (Geocoding itself lives in src/lib/amap.js — 高德 reverse geocoding.)

// Downscale an image File to a JPEG whose longest edge <= maxEdge.
// Returns { base64, blob, width, height }.
export function compressImage(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objUrl) // release the blob URL once decoded, or every upload leaks it
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
    img.onerror = () => {
      URL.revokeObjectURL(objUrl)
      reject(new Error('无法读取该图片'))
    }
    img.src = objUrl
  })
}

// Bytes -> human readable, for showing upload size.
export function prettyBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

// ---- Distance helpers for the map tab / 附近 mode ----

// Great-circle distance in meters between two {lat, lng} points (WGS-84 math;
// our stored coords are GCJ-02 but both sides of the comparison are GCJ-02,
// and the relative ordering/short distances a radius filter needs are fine).
export function haversineM(a, b) {
  if (!a || !b) return Infinity
  const R = 6371000 // Earth radius, meters
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(Number(b.lat) - Number(a.lat))
  const dLng = toRad(Number(b.lng) - Number(a.lng))
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(Number(a.lat))) * Math.cos(toRad(Number(b.lat))) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Human distance for chips/cards: 850 m under a kilometre, else 1.2 km.
export function fmtDistance(m) {
  if (!Number.isFinite(m)) return ''
  if (m < 1000) return `${Math.max(1, Math.round(m))} m`
  return `${(m / 1000).toFixed(1)} km`
}

// Entries that CAN be placed on the map (legacy entries may lack coords).
export function entriesWithCoords(entries) {
  return (Array.isArray(entries) ? entries : []).filter(
    (e) => e && Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lng)),
  )
}
