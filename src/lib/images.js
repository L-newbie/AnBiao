// Image URL helpers, shared by the feed card, the Mine lists and the detail
// view. The same three-line imgSrc computed used to be copy-pasted into each
// of them; thumbnails added a second rule on top, so it lives here now.

// Full-size original.
//
// Pending (_local) entries carry an absolute data-branch raw URL — their image
// isn't in dist/images until a deploy, so the only live copy is on the data
// branch. Aggregated entries carry a relative path (images/<id>.jpg) that has
// to be prefixed with BASE_URL to resolve under the /proxima/ Pages subpath.
export function imageSrc(entry) {
  const img = entry && entry.image
  if (!img) return ''
  return isAbsolute(img) ? img : import.meta.env.BASE_URL + img
}

// Downscaled copy for list views (48px rows, ~180px feed cards). Generated at
// build time by scripts/aggregate.js into dist/images/<id>_thumb.jpg.
//
// Returns '' when no thumbnail can exist, which is the signal for callers to
// use the original instead:
//   - absolute raw URLs: _local entries pending aggregation, thumbnails are
//     only ever written to dist, never to the data branch
//   - anything that isn't a plain images/<name>.<ext> path
//
// A thumbnail can also be missing when sharp failed on that one image (the
// build logs it and carries on) — that case can't be detected here, so the
// list views also handle <img> onerror by swapping in the original.
export function thumbSrc(entry) {
  const img = entry && entry.image
  if (!img || isAbsolute(img)) return ''
  const slash = img.lastIndexOf('/')
  const dot = img.lastIndexOf('.')
  // The dot has to be inside the filename and not its first character, or
  // there's no extension to swap: "images/weird" and "images/.hidden" both
  // fall through to the original.
  if (dot <= slash + 1) return ''
  return import.meta.env.BASE_URL + img.slice(0, dot) + '_thumb.jpg'
}

// Thumbnail if one should exist, else the original. Use for the initial src.
export function listSrc(entry) {
  return thumbSrc(entry) || imageSrc(entry)
}

function isAbsolute(url) {
  return /^(https?:)?\/\//.test(url)
}
