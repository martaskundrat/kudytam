/**
 * Vyhledávání adres a míst přes Transitous /geocode a /reverse-geocode (data OpenStreetMap)
 * a rozpoznání zadaných GPS souřadnic.
 * Volá se přes proxy /api/transitous/* (povinný User-Agent s kontaktem).
 */
import type { LatLon, Place } from '../types'
import { distanceM } from './geo'

interface GeoArea {
  name: string
  adminLevel?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPlace(r: any): Place {
  // bez státu a správních obvodů („SO Praha 2“, „SO POÚ Beroun“)
  const areas: GeoArea[] = (r.areas ?? []).filter((a: GeoArea) => a.name && a.name !== 'Česko' && !/^SO\s/.test(a.name))
  // nejpodrobnější celky (městská část, obec) první
  const sorted = [...new Set([...areas].sort((a, b) => (b.adminLevel ?? 0) - (a.adminLevel ?? 0)).map((a) => a.name))]
  // „Praha 2, obvod Praha 2“ -> „Praha 2“
  const local = sorted.filter((n) => !(n.startsWith('obvod ') && sorted.includes(n.slice('obvod '.length))))
  const name = r.type === 'ADDRESS' && r.street ? `${r.street} ${r.houseNumber ?? ''}`.trim() : r.name
  return { name, detail: local.slice(0, 2).join(', '), lat: r.lat, lon: r.lon }
}

export async function searchAddresses(query: string, near?: LatLon | null, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const params = new URLSearchParams({ text: q, type: 'ADDRESS,PLACE', numResults: '10', language: 'cs' })
  if (near) {
    params.set('place', `${near.lat},${near.lon}`)
    params.set('placeBias', '3') // upřednostni okolí, ale nevylučuj zbytek ČR
  }
  const res = await fetch(`/api/transitous/geocode?${params}`, { signal })
  if (!res.ok) throw new Error('Vyhledávání adres je teď nedostupné.')
  const data: any[] = await res.json()

  const seen = new Set<string>()
  const out: Place[] = []
  for (const r of data) {
    if (r.country && r.country !== 'CZ') continue
    const p = toPlace(r)
    // stejná adresa se v OSM často opakuje (vchody, budova, provozovna) i pod různými
    // tvary čísla (1409/12 vs. 12) – stejné místo do 40 m bereme jako duplicitu
    const key = `${p.name}|${p.detail}`
    if (seen.has(key) || out.some((o) => distanceM(o, p) < 40)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= 6) break
  }
  return out
}

/** Nejbližší adresa / místo k souřadnicím (pro pojmenování GPS bodu). */
export async function reverseGeocode(p: LatLon, signal?: AbortSignal): Promise<Place | null> {
  const params = new URLSearchParams({ place: `${p.lat},${p.lon}`, type: 'ADDRESS,PLACE', language: 'cs' })
  const res = await fetch(`/api/transitous/reverse-geocode?${params}`, { signal })
  if (!res.ok) return null
  const data: any[] = await res.json()
  const hit = data.find((r) => distanceM(p, r) < 150)
  return hit ? toPlace(hit) : null
}

/* ---------- GPS souřadnice ---------- */

const num = (s: string) => Number(s.replace(',', '.'))

/** Jedna souřadnice ve stupních, minutách a vteřinách: 50°4'43.0"N, 50°4.717'N, N 50°4'43" */
const DMS = /([NSEWV])?\s*(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|''))?\s*([NSEWV])?/g

function fromHemis(value: number, h?: string) {
  return h === 'S' || h === 'W' ? -value : value
}

function finish(a: number, b: number, ha?: string, hb?: string): LatLon | null {
  let lat = a
  let lon = b
  // pořadí podle světových stran (V = východ)
  const latFirst = !ha || ha === 'N' || ha === 'S'
  if (!latFirst || hb === 'N' || hb === 'S') [lat, lon] = [b, a]
  // časté prohození (zeměpisná délka napsaná první): v ČR je šířka 48–51, délka 12–19
  if (!ha && !hb && lat >= 12 && lat <= 19 && lon >= 48 && lon <= 51.5) [lat, lon] = [lon, lat]
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/**
 * Rozpozná GPS souřadnice v textu. Podporuje desetinné stupně (i s desetinnou čárkou),
 * stupně/minuty/vteřiny, světové strany (N/S/E/W, V = východ) a odkazy z Google Map a Mapy.cz.
 */
export function parseCoordinates(text: string): LatLon | null {
  const t = text.trim()
  if (!/\d/.test(t)) return null
  // české zkratky: s. š. = N, j. š. = S, v. d. = E, z. d. = W
  const T = t
    .replace(/s\.\s*š\.?/gi, 'N')
    .replace(/j\.\s*š\.?/gi, 'S')
    .replace(/v\.\s*d\.?/gi, 'E')
    .replace(/z\.\s*d\.?/gi, 'W')
    .toUpperCase()

  // odkazy: Google (@lat,lon / q=lat,lon), Mapy.cz (x=lon&y=lat)
  const at = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? t.match(/[?&](?:q|ll|query|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i)
  if (at) return finish(Number(at[1]), Number(at[2]))
  const mx = t.match(/[?&]x=(-?\d+\.\d+)/)
  const my = t.match(/[?&]y=(-?\d+\.\d+)/)
  if (mx && my) return finish(Number(my[1]), Number(mx[1]))

  // stupně, minuty, vteřiny
  if (T.includes('°')) {
    const parts = [...T.matchAll(DMS)].filter((m) => m[2])
    if (parts.length >= 2) {
      const val = (m: RegExpMatchArray) => num(m[2]) + (m[3] ? num(m[3]) / 60 : 0) + (m[4] ? num(m[4]) / 3600 : 0)
      const h = (m: RegExpMatchArray) => (m[1] ?? m[5])?.replace('V', 'E')
      const [a, b] = parts
      return finish(fromHemis(val(a), h(a)), fromHemis(val(b), h(b)), h(a), h(b))
    }
  }

  // desetinné stupně: „50.0786, 14.4345“, „50,0786 14,4345“, „N 50.0786 E 14.4345“, „50.0786N, 14.4345E“
  const dec =
    T.match(/^([NSEWV])?\s*(-?\d{1,3}\.\d+)\s*°?\s*([NSEWV])?\s*[,;\s]\s*([NSEWV])?\s*(-?\d{1,3}\.\d+)\s*°?\s*([NSEWV])?$/) ??
    T.match(/^([NSEWV])?\s*(-?\d{1,3},\d+)\s*°?\s*([NSEWV])?\s*[;\s]\s*([NSEWV])?\s*(-?\d{1,3},\d+)\s*°?\s*([NSEWV])?$/)
  if (dec) {
    const ha = (dec[1] ?? dec[3])?.replace('V', 'E')
    const hb = (dec[4] ?? dec[6])?.replace('V', 'E')
    return finish(fromHemis(num(dec[2]), ha), fromHemis(num(dec[5]), hb), ha, hb)
  }
  return null
}

export const formatCoords = (p: LatLon) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
