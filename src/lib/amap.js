// 高德 AMap JS API 2.0 loader + reverse geocoder.
//
// The JS API requires (since 2021-12-02) a security code set on
// window._AMapSecurityConfig BEFORE the script tag loads, otherwise every call
// fails with INVALID_USER_SCODE. We set it synchronously, then inject the
// script once and cache the resolved AMap global so repeated modal opens reuse
// it instantly.
//
// Coordinates are GCJ-02 throughout (map display, Geolocation, Geocoder), so
// the happy path is internally consistent — no WGS-84 conversion is needed.
// When no key is configured (local preview), hasAMap() is false and callers
// fall back to navigator.geolocation (WGS-84) + a built-in city list.

import { config } from './config.js'

let amapPromise = null

// True when the JS API key is configured AND the security secret is section —
// Geocoder/Geolocation both FAIL with INVALID_USER_DOMAIN if securityJsCode is
// empty even when the key itself is valid, so is-configured means both must be
// non-empty, not just the key.
export function hasAMap() {
  const ok = Boolean(config.amapKey) && Boolean(config.amapSecret)
  if (!ok) {
    console.warn(
      '[proxima] hasAMap=false —',
      !config.amapKey
        ? 'VITE_AMAP_KEY is empty'
        : !config.amapSecret
          ? 'VITE_AMAP_SECRET is empty (placeholder survived?) — Geocoder/Geolocation will 403 INVALID_USER_DOMAIN'
          : 'unknown',
    )
  }
  return ok
}

// Loads the AMap global once. Resolves to window.AMap. Rejects with a sentinel
// error when no key is configured so callers can branch to the fallback UI.
// Loads the AMap global once. Resolves to window.AMap. Rejects with a sentinel
// error when no key is configured so callers can branch to the fallback UI.
//
// !! Important details for retries: a FAILED load must NOT poison the promise
// cache — if the first attempt times out (offline, blocked proxy, JS server
// blip) we clear amapPromise so a later refresh retries instead of instantly
// rejecting. Also: retries are cheap because the script tag de-dupes via URL.
const AMAP_SCRIPT_TIMEOUT_MS = 15000

export function loadAMap() {
  console.debug(
    '[proxima] loadAMap() — key set:',
    Boolean(config.amapKey),
    'secret set:',
    Boolean(config.amapSecret),
    'cached promise:',
    Boolean(amapPromise),
  )

  if (amapPromise) {
    console.debug('[proxima] loadAMap: reusing in-flight/resolved promise')
    return amapPromise
  }
  if (!hasAMap()) {
    amapPromise = Promise.reject(new Error('AMAP_KEY_NOT_CONFIGURED'))
    return amapPromise
  }

  amapPromise = new Promise((resolve, reject) => {
    // 1. Security config MUST exist before the script executes.
    window._AMapSecurityConfig = { securityJsCode: config.amapSecret || '' }
    console.debug('[proxima] _AMapSecurityConfig set, injecting AMap script…')

    // 2. Inject the script with Geocoder + Geolocation plugins.
    const s = document.createElement('script')
    s.src =
      'https://webapi.amap.com/maps?v=2.0&key=' +
      encodeURIComponent(config.amapKey) +
      '&plugin=AMap.Geocoder,AMap.Geolocation'
    s.async = true

    let settled = false
    let timer = null
    function finish(err, value) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (err) {
        amapPromise = null // failed: allow the next call to retry cleanly
        console.error('[proxima] loadAMap failed:', err.message)
        reject(err)
      } else {
        console.debug('[proxima] loadAMap OK — AMap global present, plugins ready')
        resolve(value)
      }
    }

    s.onload = () => {
      console.debug('[proxima] AMap script onload fired; window.AMap =', Boolean(window.AMap))
      window.AMap ? finish(null, window.AMap) : finish(new Error('高德地图加载失败'))
    }
    s.onerror = () => finish(new Error('高德地图脚本加载失败，请检查网络'))
    // Hard timeout: script stalls (partial network, sandboxed iframe, offline
    // jail) → reject so the app falls back to a static layout instead of
    // hanging on "地图加载中…" forever.
    timer = setTimeout(() => {
      finish(new Error('高德地图加载超时，请检查网络或稍后重试'))
    }, AMAP_SCRIPT_TIMEOUT_MS)

    document.head.appendChild(s)
  })
  return amapPromise
}

// Reverse-geocode a GCJ-02 point to { city, address, district }.
// Municipalities (北京/上海/天津/重庆) return an empty-string city, so we fall
// back to province to keep them from being treated as legacy no-city entries.
export async function reverseGeocode({ lng, lat }) {
  const AMap = await loadAMap()
  return new Promise((resolve, reject) => {
    const geocoder = new AMap.Geocoder({ city: '全国', radius: 1000 })
    geocoder.getAddress([lng, lat], (status, result) => {
      if (status !== 'complete' || !result || !result.regeocode) {
        reject(new Error('逆地理编码失败'))
        return
      }
      const r = result.regeocode
      const ac = r.addressComponent || {}
      const rawCity = ac.city || ac.province || ''
      resolve({
        city: asString(rawCity),
        address: r.formattedAddress || '',
        district: asString(ac.district),
      })
    })
  })
}

// AMap occasionally returns arrays for city/district in edge cases.
function asString(v) {
  if (Array.isArray(v)) return v[0] || ''
  return typeof v === 'string' ? v : ''
}

// Forward-geocode an address string to a GCJ-02 point [{lng, lat}, ...].
// Used by the location modal's address search box.
export async function forwardGeocode(address) {
  if (!address?.trim()) return []
  const AMap = await loadAMap()
  return new Promise((resolve, reject) => {
    const geocoder = new AMap.Geocoder({ city: '全国' })
    geocoder.getLocation(address.trim(), (status, result) => {
      if (status !== 'complete' || !result || !result.geocodes || !result.geocodes.length) {
        resolve([])
        return
      }
      resolve(
        result.geocodes.map((g) => ({
          lng: g.location.getLng(),
          lat: g.location.getLat(),
          address: g.formattedAddress || address,
        })),
      )
    })
  })
}

// Built-in city list for the no-key fallback picker (直辖市 + 省会 + 主要城市).
export const FALLBACK_CITIES = [
  '北京市',
  '上海市',
  '天津市',
  '重庆市',
  '广州市',
  '深圳市',
  '杭州市',
  '南京市',
  '苏州市',
  '武汉市',
  '成都市',
  '西安市',
  '长沙市',
  '郑州市',
  '青岛市',
  '沈阳市',
  '哈尔滨市',
  '长春市',
  '大连市',
  '济南市',
  '合肥市',
  '福州市',
  '厦门市',
  '昆明市',
  '贵阳市',
  '南宁市',
  '太原市',
  '石家庄市',
  '南昌市',
  '兰州市',
  '银川市',
  '西宁市',
  '海口市',
  '呼和浩特市',
  '乌鲁木齐市',
  '拉萨市',
]
