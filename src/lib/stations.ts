/** Vyhledávání stanic PID nad lokálním seznamem (public/stops.json, viz scripts/build-stops.mjs). */
import type { LatLon, Place, Stop } from '../types'
import { distanceM } from './geo'
import { normalize } from './text'

type PlatformRow = [string, number, number, string, string]
type Row = [string, string, string, number, number, string, string, PlatformRow[], string]
interface Station extends Place {
  key: string
  platforms: PlatformRow[]
  lines: string[]
}

let loading: Promise<Station[]> | null = null

export function loadStations(): Promise<Station[]> {
  loading ??= fetch('/stops.json')
    .then((r) => {
      if (!r.ok) throw new Error('Seznam stanic se nepodařilo načíst.')
      return r.json() as Promise<{ stops: Row[] }>
    })
    .then(({ stops }) =>
      stops.map(([unique, name, municipality, lat, lon, zones, types, platforms, lines]) => ({
        name: unique,
        stopName: name,
        detail: [municipality !== name ? municipality : '', zones && `pásmo ${zones}`].filter(Boolean).join(' · '),
        zones: zones ? zones.split(',') : [],
        types: types ? types.split(',') : [],
        lat,
        lon,
        key: normalize(unique).replace(/[.,\-]/g, ' '),
        platforms: platforms ?? [],
        lines: lines ? lines.split(",") : [],
      })),
    )
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

/** Prefix každého slova má přednost, pak libovolná shoda; uvnitř skupin bližší dřív. */
export async function searchStations(query: string, near?: LatLon | null, limit = 8): Promise<Place[]> {
  const q = normalize(query).replace(/[.,\-]/g, ' ').trim()
  if (q.length < 2) return []
  const words = q.split(/\s+/)
  const all = await loadStations()
  const scored: { s: Station; score: number }[] = []
  for (const s of all) {
    if (!words.every((w) => s.key.includes(w))) continue
    let score = s.key === q ? -1 : s.key.startsWith(q) ? 0 : words.every((w) => s.key.split(/\s+/).some((t) => t.startsWith(w))) ? 1 : 2
    if (s.types?.includes('metro') || s.types?.includes('train')) score -= 0.3
    if (near) score += Math.min(distanceM(near, s) / 50000, 0.9) // do 50 km mírně zvýhodni blízké
    scored.push({ s, score })
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ s }) => ({ name: s.name, stopName: s.stopName, detail: s.detail, zones: s.zones, types: s.types, lat: s.lat, lon: s.lon }))
}

/**
 * Nástupiště v okruhu `radius` metrů (GTFS ID pro odjezdové tabule Golemio).
 * Hrubý filtr přes obdélník, pak přesná vzdálenost.
 */
export async function nearbyPlatforms(center: LatLon, radius: number): Promise<Stop[]> {
  const all = await loadStations()
  const dLat = radius / 111320 + 0.005
  const dLon = radius / (111320 * Math.cos((center.lat * Math.PI) / 180)) + 0.005
  const out: Stop[] = []
  for (const st of all) {
    if (Math.abs(st.lat - center.lat) > dLat || Math.abs(st.lon - center.lon) > dLon) continue
    for (const [id, lat, lon, platform, zones] of st.platforms) {
      const distance = distanceM(center, { lat, lon })
      if (distance > radius) continue
      out.push({ id, name: st.stopName ?? st.name, platform: platform || undefined, zones: zones ? zones.split(',').filter(Boolean) : (st.zones ?? []), lat, lon, distance })
    }
  }
  return out.sort((a, b) => a.distance - b.distance)
}

/** Linky, které projíždějí stanicemi s danými názvy (podle jízdních řádů PID). */
export async function linesAt(stopNames: Iterable<string>): Promise<Set<string>> {
  const wanted = new Set([...stopNames].map(normalize))
  const out = new Set<string>()
  for (const st of await loadStations()) if (wanted.has(normalize(st.stopName ?? st.name))) st.lines.forEach((l) => out.add(l))
  return out
}

let codeIndex: Map<string, string> | null = null

/** Označení nástupiště PID podle GTFS ID („U400Z1P“ → „A“); undefined = neznámé (např. vlakové zastávky PID). */
export async function platformCodes(): Promise<(gtfsId: string) => string | undefined> {
  if (!codeIndex) {
    const idx = new Map<string, string>()
    for (const st of await loadStations()) for (const [id, , , code] of st.platforms) if (code) idx.set(id, code)
    codeIndex = idx
  }
  const idx = codeIndex
  return (id) => idx.get(id)
}

let zoneIndex: Map<string, string[]> | null = null

/** Pásma nástupiště podle GTFS ID (např. "U1040Z102P"); undefined = mimo PID / neznámé. */
export async function platformZones(): Promise<(gtfsId: string) => string[] | undefined> {
  if (!zoneIndex) {
    const idx = new Map<string, string[]>()
    for (const st of await loadStations())
      for (const [id, , , , zones] of st.platforms) idx.set(id, zones ? zones.split(',').filter(Boolean) : (st.zones ?? []))
    zoneIndex = idx
  }
  const idx = zoneIndex
  return (id) => idx.get(id)
}

/**
 * Pásma podle polohy – nejbližší nástupiště PID do `maxM` metrů.
 * Pro úseky z jiných datových sad (např. vlaky ČD v celostátních datech), které nemají ID zastávek PID.
 */
export async function zonesNear(): Promise<(p: LatLon, maxM?: number) => string[] | undefined> {
  const all = await loadStations()
  return (p, maxM = 200) => {
    let best: string[] | undefined
    let bestD = maxM
    const dLat = maxM / 111320
    for (const st of all) {
      if (Math.abs(st.lat - p.lat) > dLat + 0.01 || Math.abs(st.lon - p.lon) > dLat * 1.6 + 0.01) continue
      for (const [, lat, lon, , zones] of st.platforms) {
        const d = distanceM(p, { lat, lon })
        if (d < bestD && zones) {
          bestD = d
          best = zones.split(',').filter(Boolean)
        }
      }
    }
    return best
  }
}
