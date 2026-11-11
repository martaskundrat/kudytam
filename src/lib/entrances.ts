/**
 * Kterým vstupem / výstupem metra jít (E1, E2…) – u pěších úseků, které navazují na metro.
 *
 * Transitous vede pěší trasu po OpenStreetMap včetně pater (fromLevel / toLevel): místo, kde trasa
 * vyjde z podzemí (patro < 0 → ≥ 0), je výstup; kde do něj vstoupí, je vstup. K tomu místu se najde
 * nejbližší vstup metra z OSM (metro-entrances.ts). Bez údajů o patrech se vezme vstup, kolem kterého
 * trasa prochází nejblíž začátku (výstup) / konci (vstup).
 */
import { distanceM } from './geo'
import { METRO_ENTRANCES } from './metro-entrances'
import type { LatLon } from '../types'

export interface Entrance {
  /** označení vstupu/výstupu, např. „E2“ */
  code: string
  wheelchair: boolean
}

/** dekódování polyline (Google formát, Transitous posílá přesnost 7 desetinných míst) */
export function decodePolyline(str: string, precision = 7): LatLon[] {
  const factor = 10 ** precision
  const out: LatLon[] = []
  let lat = 0
  let lon = 0
  let i = 0
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0
      let result = 0
      let b: number
      do {
        b = str.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20 && i < str.length)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lon += delta
    }
    out.push({ lat: lat / factor, lon: lon / factor })
  }
  return out
}

/** nejbližší vstup metra k bodu (do maxM metrů) */
function nearestEntrance(p: LatLon, maxM: number): Entrance | undefined {
  let best: Entrance | undefined
  let bestD = maxM
  for (const [lat, lon, code, wc] of METRO_ENTRANCES) {
    if (Math.abs(lat - p.lat) > 0.001 || Math.abs(lon - p.lon) > 0.0015) continue
    const d = distanceM(p, { lat, lon })
    if (d < bestD) [best, bestD] = [{ code, wheelchair: wc === 1 }, d]
  }
  return best
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const pts = (poly: any): LatLon[] => (poly?.points ? decodePolyline(poly.points, poly.precision ?? 7) : [])

/**
 * Vstup / výstup metra pro pěší úsek Transitous.
 * @param dir 'exit' = úsek začíná po jízdě metrem, 'entry' = úsek končí nástupem do metra
 */
export function entranceOf(leg: any, dir: 'exit' | 'entry'): Entrance | undefined {
  const steps: any[] = leg?.steps ?? []
  // 1) podle pater: první výstup z podzemí / poslední sestup do podzemí
  const lvl = (v: any) => (typeof v === 'number' ? v : Number.NaN)
  const up = (s: any) => lvl(s.fromLevel) < 0 && lvl(s.toLevel) >= 0
  const down = (s: any) => lvl(s.fromLevel) >= 0 && lvl(s.toLevel) < 0
  const step = dir === 'exit' ? steps.find(up) : [...steps].reverse().find(down)
  if (step) {
    const line = pts(step.polyline)
    const at = dir === 'exit' ? line[line.length - 1] : line[0]
    const hit = at && nearestEntrance(at, 40)
    if (hit) return hit
  }
  // 2) bez pater: vstup, kolem kterého trasa vede (do 20 m) – nejblíž začátku / konci trasy
  const path = pts(leg?.legGeometry)
  const order = dir === 'exit' ? path : [...path].reverse()
  for (const p of order) {
    const hit = nearestEntrance(p, 20)
    if (hit) return hit
  }
  return undefined
}
