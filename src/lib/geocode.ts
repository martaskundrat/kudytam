/**
 * Vyhledávání adres, míst a zastávek v celé ČR přes Transitous /geocode a /reverse-geocode
 * (data OpenStreetMap a jízdní řády) a rozpoznání zadaných GPS souřadnic.
 * Volá se přes proxy /api/transitous/* (povinný User-Agent s kontaktem).
 */
import type { LatLon, Place, SearchScope } from '../types'
import { distanceM, inCzechia } from './geo'

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
  // v zahraničí i stát (Paříž, FR)
  const detail = [...local.slice(0, 2), ...(r.country && r.country !== 'CZ' ? [r.country] : [])].join(', ')
  return { name, detail: r.type === 'STOP' ? `Zastávka${detail ? ` · ${detail}` : ''}` : detail, lat: r.lat, lon: r.lon, tz: r.tz ?? undefined }
}

/** evropské státy (ISO 3166-1 alpha-2) pro rozsah „Evropa“ */
const EUROPE = new Set(
  'AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FI FR GE DE GI GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA FO IM JE GG AX'.split(' '),
)
/** zhruba Evropa – pro výsledky bez uvedeného státu */
const europeBox = (p: LatLon) => p.lat >= 34 && p.lat <= 72 && p.lon >= -25 && p.lon <= 45

function inScope(r: any, scope: SearchScope): boolean {
  if (scope === 'world') return true
  if (scope === 'cz') return r.country ? r.country === 'CZ' && inCzechia(r) : inCzechia(r)
  return r.country ? EUROPE.has(r.country) : europeBox(r)
}

export async function searchAddresses(query: string, near?: LatLon | null, signal?: AbortSignal, scope: SearchScope = 'cz'): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 3) return []
  // i zastávky a nádraží v celé ČR (zastávky PID hledá aplikace sama ve vlastním seznamu)
  const params = new URLSearchParams({ text: q, type: 'ADDRESS,PLACE,STOP', numResults: scope === 'cz' ? '15' : '25', language: 'cs' })
  // v ČR upřednostni okolí; v Evropě a ve světě jen mírně, ať se najde i Paříž z Prahy
  if (near && scope === 'cz') {
    params.set('place', `${near.lat},${near.lon}`)
    params.set('placeBias', '3') // upřednostni okolí, ale nevylučuj zbytek ČR
  }
  const res = await fetch(`/api/transitous/geocode?${params}`, { signal })
  if (!res.ok) throw new Error('Vyhledávání adres je teď nedostupné.')
  const data: any[] = await res.json()

  const seen = new Set<string>()
  const out: Place[] = []
  for (const r of data) {
    if (!inScope(r, scope)) continue
    // zastávky v ČR jen z českých jízdních řádů (zahraniční sady mají české zastávky pod cizími názvy);
    // zastávky PID hledá aplikace sama ve vlastním seznamu
    const id = String(r.id ?? '')
    if (r.type === 'STOP' && (id.startsWith('cz-PID_') || (inCzechia(r) && !id.startsWith('cz-')))) continue
    const p = toPlace(r)
    // tatáž zastávka bývá ve více datových sadách (ČR, Slovensko, Maďarsko) – stejné jméno do 300 m je duplicita
    if (r.type === 'STOP' && out.some((o) => o.name === p.name && distanceM(o, p) < 300)) continue
    // stejná adresa se v OSM často opakuje (vchody, budova, provozovna) i pod různými
    // tvary čísla (1409/12 vs. 12) – stejné místo do 40 m bereme jako duplicitu
    const key = `${p.name}|${p.detail}`
    if (seen.has(key) || out.some((o) => distanceM(o, p) < 40)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= (scope === 'cz' ? 8 : 12)) break
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

/* ---------- okres (pro odkazy do IDOS) ---------- */

const okresCache = new Map<string, Promise<string | null>>()
const okresKey = (p: LatLon) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`

/**
 * Okres místa (`okres Praha-východ` → `Praha-východ`, Praha → `Praha`). IDOS podle něj rozliší
 * stejně pojmenovaná místa („Říčany; Praha-východ“). Výsledky se pamatují.
 */
export function okresAt(p: LatLon): Promise<string | null> {
  const key = okresKey(p)
  let hit = okresCache.get(key)
  if (!hit) {
    hit = fetch(`/api/transitous/reverse-geocode?${new URLSearchParams({ place: `${p.lat},${p.lon}`, type: 'ADDRESS,PLACE', language: 'cs' })}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: any[]) => {
        const areas: GeoArea[] = data[0]?.areas ?? []
        if (areas.some((a) => a.adminLevel === 4 && a.name === 'Praha')) return 'Praha'
        const okres = areas.find((a) => a.adminLevel === 5 && a.name.startsWith('okres '))
        return okres ? okres.name.slice('okres '.length) : null
      })
      .catch(() => null)
    okresCache.set(key, hit)
  }
  return hit
}

/**
 * Český název zastávky z celostátních jízdních řádů (JDF autobusy, CZPTT vlaky) poblíž bodu.
 * Mezinárodní dopravci (FlixBus) mají v datech anglické názvy („Prague (Main Railway Station)“),
 * které IDOS nezná.
 */
async function czechStopName(p: LatLon): Promise<string | null> {
  const res = await fetch(`/api/transitous/reverse-geocode?${new URLSearchParams({ place: `${p.lat},${p.lon}`, type: 'STOP', language: 'cs' })}`)
  if (!res.ok) return null
  const data: any[] = await res.json()
  const hit = data.find((r) => /^cz-(JDF|CZPTT)/.test(String(r.id ?? '')) && distanceM(p, r) < 300)
  return hit?.name ?? null
}

export interface IdosHint {
  okres: string | null
  /** český název místo názvu z dat dopravce */
  name?: string | null
}
const idosResolved = new Map<string, IdosHint>()

/** okres a případně český název z paměti (bez čekání) – undefined, pokud se ještě nedohledal */
export const idosHint = (p: LatLon): IdosHint | undefined => idosResolved.get(okresKey(p))

/** Dohledá pro odkazy do IDOS okres zastávek a u zahraničních dat (stopId mimo „cz-“) i český název. */
export async function resolveIdos(points: (LatLon & { stopId?: string })[]): Promise<void> {
  await Promise.all(
    points.map(async (p) => {
      if (idosResolved.has(okresKey(p))) return
      const foreign = !!p.stopId && !p.stopId.startsWith('cz-')
      const [okres, name] = await Promise.all([okresAt(p), foreign ? czechStopName(p).catch(() => null) : null])
      idosResolved.set(okresKey(p), { okres, name })
    }),
  )
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
