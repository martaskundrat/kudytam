/**
 * Vyhledávání adres a míst přes Transitous /geocode (data OpenStreetMap).
 * Volá se přes proxy /api/transitous/geocode (povinný User-Agent s kontaktem).
 */
import type { LatLon, Place } from '../types'
import { distanceM } from './geo'

interface GeoArea {
  name: string
  adminLevel?: number
  matched?: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    // bez státu a správních obvodů („SO Praha 2“, „SO POÚ Beroun“)
    const areas: GeoArea[] = (r.areas ?? []).filter((a: GeoArea) => a.name && a.name !== 'Česko' && !/^SO\s/.test(a.name))
    // nejpodrobnější celky (městská část, obec) první
    const sorted = [...new Set([...areas].sort((a, b) => (b.adminLevel ?? 0) - (a.adminLevel ?? 0)).map((a) => a.name))]
    // „Praha 2, obvod Praha 2“ -> „Praha 2“
    const local = sorted.filter((n) => !(n.startsWith('obvod ') && sorted.includes(n.slice('obvod '.length))))
    const name = r.type === 'ADDRESS' && r.street ? `${r.street} ${r.houseNumber ?? ''}`.trim() : r.name
    const detail = local.slice(0, 2).join(', ')
    // stejná adresa se v OSM často opakuje (vchody, budova, provozovna)
    const key = `${name}|${local[0] ?? ''}`
    // … a pod různými tvary čísla (1409/12 vs. 12) – stejné místo do 40 m bereme jako duplicitu
    if (seen.has(key) || out.some((p) => distanceM(p, r) < 40)) continue
    seen.add(key)
    out.push({ name, detail, lat: r.lat, lon: r.lon })
    if (out.length >= 6) break
  }
  return out
}
