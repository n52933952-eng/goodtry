/**
 * Lichess piece SVGs (fantasy, spatial, celtic, dubrovny, …) chain gradients with
 * xlink:href / href. react-native-svg often drops those fills, so only black strokes
 * show for both sides. Inlining referenced stops restores the intended colors.
 */
function stripGradientHref(attrs: string): string {
  return attrs
    .replace(/\s*xlink:href="#[^"]+"/gi, '')
    .replace(/\s*href="#[^"]+"/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractGradientStopsById(svg: string, tag: 'linearGradient' | 'radialGradient'): Map<string, string> {
  const map = new Map<string, string>()
  const re = new RegExp(`<${tag}\\s([^>]+)>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const attrs = m[1]
    const inner = m[2]
    const idMatch = /id="([^"]+)"/i.exec(attrs)
    if (!idMatch) continue
    if (inner.includes('<stop')) {
      map.set(idMatch[1], inner.trim())
    }
  }
  return map
}

function expandSelfClosingGradients(
  svg: string,
  tag: 'linearGradient' | 'radialGradient',
  stopsById: Map<string, string>,
): { next: string; changed: boolean } {
  let changed = false
  /** Attribute list cannot contain unescaped `>`, so [^>]+ is safe before `/>`. */
  const re = new RegExp(`<${tag}\\s([^>]+)/>`, 'gi')
  const next = svg.replace(re, (full, attrs: string) => {
    const hrefMatch = attrs.match(/(?:xlink:href|href)="#([^"]+)"/i)
    if (!hrefMatch) return full
    const refId = hrefMatch[1]
    const stops = stopsById.get(refId)
    if (!stops) return full
    changed = true
    const clean = stripGradientHref(attrs)
    return `<${tag} ${clean}>${stops}</${tag}>`
  })
  return { next, changed }
}

function expandEmptyPairedGradients(
  svg: string,
  tag: 'linearGradient' | 'radialGradient',
  stopsById: Map<string, string>,
): { next: string; changed: boolean } {
  let changed = false
  const re = new RegExp(`<${tag}\\s([^>]+)>\\s*<\\/${tag}>`, 'gi')
  const next = svg.replace(re, (full, attrs: string) => {
    const hrefMatch = attrs.match(/(?:xlink:href|href)="#([^"]+)"/i)
    if (!hrefMatch) return full
    const refId = hrefMatch[1]
    const stops = stopsById.get(refId)
    if (!stops) return full
    changed = true
    const clean = stripGradientHref(attrs)
    return `<${tag} ${clean}>${stops}</${tag}>`
  })
  return { next, changed }
}

export function flattenSvgGradientXlinks(svg: string): string {
  let out = svg
  let guard = 0
  while (guard++ < 24) {
    const linearStops = extractGradientStopsById(out, 'linearGradient')
    const radialStops = extractGradientStopsById(out, 'radialGradient')
    let changed = false

    for (const tag of ['linearGradient', 'radialGradient'] as const) {
      const stops = tag === 'linearGradient' ? linearStops : radialStops
      const a = expandSelfClosingGradients(out, tag, stops)
      out = a.next
      if (a.changed) changed = true
      const b = expandEmptyPairedGradients(out, tag, stops)
      out = b.next
      if (b.changed) changed = true
    }

    if (!changed) break
  }
  return out
}

/**
 * Lichess sets like celtic / dubrovny repeat the same `id`s (e.g. `main-gradient`, `fillGradient`)
 * in every piece file. Many `SvgXml` roots on one screen can make `url(#…)` resolve the wrong
 * gradient. Prefix every `id` and matching `url(#id)` / `href="#id"` so each instance is isolated.
 */

/**
 * Celtic pieces use one large `fill="url(#main-gradient)"` on the body path.
 * On Android, react-native-svg often still fails to paint that gradient, so both
 * sides read as black. Swap that fill for a solid that matches the set’s intent.
 */
export function replaceCelticMainGradientFillWithSolid(svg: string, uri: string): string {
  if (!uri.toLowerCase().includes('/piece/celtic/')) return svg
  const white = /\/celtic\/w[pnbrqk]\.svg/i.test(uri)
  // Near Lichess stops: white #fff→#bfd3d7, black #7f899b→#1c1c2f
  const fill = white ? '#c5d8de' : '#2a3344'
  return svg.replace(/fill="url\(#main-gradient\)"/gi, `fill="${fill}"`)
}

/**
 * Dubrovny on react-native-svg: `fill="url(#…)"` gradients (and xlink-expanded defs) often **do not
 * paint** — the renderer falls back to **default black** for both white and black pieces, so every
 * piece looks black. Browsers still show gradients correctly (web looks fine).
 *
 * Fix: for Dubrovny only, strip known-bad overlay paths on white, then **replace every gradient
 * fill with a solid** — light cream for white (`/dubrovny/w…`), dark rust-brown for black (`/dubrovny/b…`).
 * Strokes stay; shapes stay readable and clearly different from each other.
 */
export function tuneDubrovnyPieceSvgForMobile(svg: string, uri: string): string {
  const u = uri.toLowerCase()
  const isWhite = /\/dubrovny\/w[pnbrqk]\.svg/i.test(u)
  const isBlack = /\/dubrovny\/b[pnbrqk]\.svg/i.test(u)
  if (!isWhite && !isBlack) return svg

  let out = svg

  if (isWhite) {
    // Near-black shadow paths (opacity often ignored → solid black slab)
    out = out.replace(/<path[^>]*\bfill="#070705"[^>]*\/>\s*/gi, '')
    // Default fill=black + opacity overlays (e.g. knight)
    out = out.replace(
      /<path(?=[^>]*\bd=")(?![^>]*\bfill=)(?![^>]*\bstroke=)[^>]*\bopacity="(?:0?\.\d+)"[^>]*\/>\s*/gi,
      '',
    )
    out = out.replace(/#aa9445/gi, '#e2d4a0').replace(/#fbf6dc/gi, '#fffef8').replace(/#070705/gi, '#8a7560')
    const light = '#f0e4d2'
    out = out.replace(/\bfill="url\(#[^)]+\)"/gi, `fill="${light}"`)
    out = out.replace(/\bfill='url\(#[^)]+\)'/gi, `fill='${light}'`)
  } else {
    const dark = '#6b352c'
    out = out.replace(/\bfill="url\(#[^)]+\)"/gi, `fill="${dark}"`)
    out = out.replace(/\bfill='url\(#[^)]+\)'/gi, `fill='${dark}'`)
    out = out.replace(
      /<path(?=[^>]*\bd=")(?![^>]*\bfill=)(?![^>]*\bstroke=)[^>]*\bopacity="(?:0?\.\d+)"[^>]*\/>\s*/gi,
      '',
    )
  }

  return out
}

export function uniquifySvgLocalIds(svg: string, prefix: string): string {
  const safe = prefix.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^-+/, '') || 'g'
  const p = `${safe}_`
  const seen = new Set<string>()
  const idRe = /\bid="([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = idRe.exec(svg)) !== null) {
    seen.add(m[1])
  }
  const ids = [...seen].sort((a, b) => b.length - a.length)
  let out = svg
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\bid="${esc}"`, 'gi'), `id="${p}${id}"`)
    out = out.replace(new RegExp(`url\\(#${esc}\\)`, 'gi'), `url(#${p}${id})`)
    out = out.replace(new RegExp(`href="#${esc}"`, 'gi'), `href="#${p}${id}"`)
    out = out.replace(new RegExp(`xlink:href="#${esc}"`, 'gi'), `xlink:href="#${p}${id}"`)
  }
  return out
}

const xmlCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

/** Dubrovny tuning changed — bump so installs don’t reuse stale cached XML from an older pipeline. */
const DUBROVNY_CACHE_BUSTER = 'dubrovnyRnSolidV1'

function pieceSvgCacheKey(uri: string): string {
  const u = uri.toLowerCase()
  if (u.includes('/piece/dubrovny/')) return `${uri}#${DUBROVNY_CACHE_BUSTER}`
  return uri
}

/** Flattened SVG for this URI if already loaded (avoids blanking the slide overlay / review). */
export function peekCachedFlattenedPieceSvg(uri: string): string | undefined {
  return xmlCache.get(pieceSvgCacheKey(uri))
}

export function loadNormalizedPieceSvg(uri: string): Promise<string> {
  const key = pieceSvgCacheKey(uri)
  const hit = xmlCache.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending
  const p = fetch(uri)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    })
    .then((raw) => {
      let xml = flattenSvgGradientXlinks(raw)
      xml = tuneDubrovnyPieceSvgForMobile(xml, uri)
      xmlCache.set(key, xml)
      inflight.delete(key)
      return xml
    })
    .catch((e) => {
      inflight.delete(key)
      throw e
    })
  inflight.set(key, p)
  return p
}
