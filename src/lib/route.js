// Framework-free hash router — deliberately NOT vue-router.
//
// The app is a map-first SPA: the Explore canvas IS the root view and every
// other screen is an overlay/deep-link on top of it. Routes:
//
//   #/map              Explore canvas (default; unknown/empty hash lands here)
//   #/feed             full-grid feed (escape hatch from the map)
//   #/mine             my entries/comments/favorites surface
//   #/entry/<id>       detail overlay for one entry
//
// Design notes:
//  - `push` adds a history entry (used when opening a detail, so the browser
//    back button == close detail). `replace` doesn't (used for top-level
//    switches, which must not spam history).
//  - `pushedByApp` records that the current entry-route was pushed by us, so
//    App's closeDetail can decide between history.back() (back out of our own
//    push) and replace(map) (a deep-linked detail has no such entry).
//  - One 'hashchange' listener is the single source of truth both directions:
//    UI actions write the hash, the listener reflects it into `route`, App
//    watchers translate route -> view state.

import { reactive } from 'vue'

const ROOTS = new Set(['map', 'feed', 'mine'])

export const route = reactive({ name: 'map', param: null })

let pushedByApp = false
let initialized = false

export function parseHash() {
  // '#/entry/abc' -> ['entry', 'abc']; '#/mine' -> ['mine']
  const raw = (location.hash || '').replace(/^#\/?/, '')
  const [name, param] = raw.split('/').map(decodeURIComponent)
  if (ROOTS.has(name)) return { name, param: param || null }
  if (name === 'entry' && param) return { name: 'entry', param }
  return { name: 'map', param: null }
}

function assign(parsed) {
  route.name = parsed.name
  route.param = parsed.param
}

export function push(name, param) {
  const hash = `#/${name}${param ? '/' + encodeURIComponent(param) : ''}`
  if (location.hash === hash) return
  pushedByApp = name === 'entry'
  location.hash = hash // triggers hashchange -> assign
}

export function replace(name, param) {
  const url =
    `${location.pathname}${location.search}` +
    `#/${name}${param ? '/' + encodeURIComponent(param) : ''}`
  pushedByApp = false
  history.replaceState(history.state, '', url)
  assign({ name, param: param || null })
}

// App's closeDetail uses this: true when the current detail was pushed in-app
// (back() removes exactly our entry), false when it came from a deep link.
export function detailPushedByApp() {
  return pushedByApp
}

// Attach the single hashchange listener. Call once from App onMounted.
export function initRoute() {
  if (initialized) return route
  initialized = true
  assign(parseHash())
  window.addEventListener('hashchange', () => {
    // Any hash change we didn't author (user back/forward, external link)
    // invalidates the "we pushed this" flag.
    pushedByApp = false
    assign(parseHash())
  })
  return route
}
