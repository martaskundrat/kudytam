/**
 * Vyhledávání spojení s přestupy přes Transitous (MOTIS 2, https://transitous.org).
 * Volá se přes vlastní proxy /api/transitous/plan (kvůli povinnému User-Agentu s kontaktem).
 *
 * Chůze na vzdálenější zastávku je součástí hledání: povolíme první úsek pěšky až do
 * „širšího okolí“, takže vyhledávač sám zváží, jestli se vyplatí dojít dál na rychlejší spoj.
 */
import type { LatLon, Place, Settings, VehicleType } from '../types'
import { platformZones, zonesNear } from './stations'

export interface LegStop {
  name: string
  gtfsId?: string
  lat: number
  lon: number
  time: number
  scheduled: number
  track?: string
}

export interface WalkLeg {
  kind: 'walk'
  from: LegStop
  to: LegStop
  durationMin: number
  meters: number
}

export interface TransitLeg {
  kind: 'transit'
  line: string
  vehicle: VehicleType
  headsign: string
  from: LegStop
  to: LegStop
  durationMin: number
  stops: number
  delayMin: number | null
  realTime: boolean
  cancelled: boolean
  wheelchair: boolean
  /** pásma PID projetá na tomto úseku; prázdné = mimo PID */
  zones: string[]
  isPid: boolean
  agency: string
}

export type Leg = WalkLeg | TransitLeg

export interface Journey {
  id: string
  /** kdy vyrazit z výchozího místa */
  start: number
  end: number
  durationMin: number
  transfers: number
  legs: Leg[]
}

const MODE: Record<string, VehicleType> = {
  SUBWAY: 'metro',
  TRAM: 'tram',
  BUS: 'bus',
  COACH: 'bus',
  TROLLEYBUS: 'trolleybus',
  FERRY: 'ferry',
  FUNICULAR: 'funicular',
  AERIAL_LIFT: 'funicular',
  RAIL: 'train',
  REGIONAL_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train',
  SUBURBAN: 'train',
  LONG_DISTANCE: 'train',
  HIGHSPEED_RAIL: 'train',
  NIGHT_RAIL: 'train',
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const PID_PREFIX = 'cz-PID_'
const gtfsOf = (stopId?: string) => (stopId?.startsWith(PID_PREFIX) ? stopId.slice(PID_PREFIX.length) : undefined)

function stopOf(p: any, at: 'departure' | 'arrival'): LegStop {
  const t = Date.parse(p[at] ?? p.departure ?? p.arrival)
  const s = Date.parse(p[at === 'departure' ? 'scheduledDeparture' : 'scheduledArrival'] ?? p[at])
  return {
    name: p.name === 'START' || p.name === 'END' ? '' : p.name,
    gtfsId: gtfsOf(p.stopId),
    lat: p.lat,
    lon: p.lon,
    time: t,
    scheduled: Number.isNaN(s) ? t : s,
    track: p.track ?? p.scheduledTrack ?? undefined,
  }
}

export interface JourneyPage {
  journeys: Journey[]
  /** kurzory Transitous pro dřívější / pozdější spojení */
  prev?: string
  next?: string
  /** parametry dotazu – pro načtení dalších stránek se musí poslat beze změny */
  query: string
}

const fetchPlan = async (query: string, cursor?: string) => {
  const res = await fetch(`/api/transitous/plan?${query}${cursor ? `&pageCursor=${encodeURIComponent(cursor)}` : ''}`)
  if (!res.ok) throw new Error(res.status === 429 ? 'Vyhledávač spojení je přetížený, zkus to za chvíli.' : `Vyhledávání spojení selhalo (${res.status}).`)
  return res.json()
}

/** Stabilní ID spojení (stejné i po obnovení dat) – podle linek a plánovaných odjezdů. */
const journeyKey = (j: Journey) =>
  j.legs.map((l) => (l.kind === 'transit' ? `${l.line}@${l.from.scheduled}` : 'w')).join('|')

/** Sloučí spojení (např. z více stránek), bez duplicit, seřazená podle odjezdu. */
export function mergeJourneys(...lists: Journey[][]): Journey[] {
  const map = new Map<string, Journey>()
  for (const list of lists) for (const j of list) map.set(j.id, j)
  return [...map.values()].sort((a, b) => a.start - b.start || a.end - b.end)
}

async function parse(data: any, origin: LatLon & { name?: string }, dest: Place): Promise<Journey[]> {
  const zonesOf = await platformZones()
  const zonesAt = await zonesNear()

  const journeys: Journey[] = (data.itineraries ?? []).map((it: any, i: number): Journey => {
    const legs: Leg[] = (it.legs ?? []).map((l: any): Leg => {
      const from = stopOf(l.from, 'departure')
      const to = stopOf(l.to, 'arrival')
      const durationMin = Math.round((l.duration ?? (to.time - from.time) / 1000) / 60)
      if (l.mode === 'WALK' || l.mode === 'BIKE' || l.mode === 'CAR') {
        return { kind: 'walk', from, to, durationMin, meters: Math.round(l.distance ?? 0) }
      }
      const ids = [l.from?.stopId, ...(l.intermediateStops ?? []).map((s: any) => s.stopId), l.to?.stopId].map(gtfsOf)
      const zones = new Set<string>()
      for (const id of ids) if (id) zonesOf(id)?.forEach((z) => zones.add(z))
      if (!zones.size) {
        // úsek z jiné datové sady (např. vlak v celostátních datech) – pásma podle polohy zastávek
        for (const p of [l.from, ...(l.intermediateStops ?? []), l.to]) zonesAt(p)?.forEach((z) => zones.add(z))
      }
      const delay = l.realTime ? Math.round((from.time - from.scheduled) / 60000) : null
      return {
        kind: 'transit',
        line: (l.routeShortName || l.displayName || l.tripShortName || '?').replace(/\s*\(.*\)$/, ''),
        vehicle: MODE[l.mode] ?? 'other',
        headsign: l.headsign ?? l.tripTo?.name ?? '',
        from,
        to,
        durationMin,
        stops: (l.intermediateStops ?? []).length + 1,
        delayMin: delay,
        realTime: !!l.realTime,
        cancelled: !!l.cancelled,
        wheelchair: !!l.wheelchairAccessible,
        zones: [...zones],
        isPid: zones.size > 0,
        agency: l.agencyName ?? '',
      }
    })
    // první/poslední pěší úsek nemá název – doplň výchozí místo a cíl
    if (legs[0]?.kind === 'walk' && !legs[0].from.name) legs[0].from.name = origin.name ?? 'Výchozí místo'
    const last = legs[legs.length - 1]
    if (last?.kind === 'walk' && !last.to.name) last.to.name = dest.name
    const start = Date.parse(it.startTime)
    const end = Date.parse(it.endTime)
    return {
      id: it.id ?? `${i}-${start}`,
      start,
      end,
      durationMin: Math.round((end - start) / 60000),
      transfers: it.transfers ?? Math.max(0, legs.filter((l) => l.kind === 'transit').length - 1),
      legs,
    }
  })

  // jen spoje s MHD; stabilní ID místo ID z Transitous (to se mezi dotazy mění)
  for (const j of journeys) j.id = journeyKey(j)
  return mergeJourneys(journeys.filter((j) => j.legs.some((l) => l.kind === 'transit')))
}

export async function planJourneys(origin: LatLon & { name?: string }, dest: Place, settings: Settings, kmh: number): Promise<JourneyPage> {
  const speed = kmh / 3.6 // m/s
  // první úsek pěšky smí vést až na zastávky v „širším okolí“ (cesta po ulicích ~1,3× delší)
  const maxPre = Math.round(Math.min(1800, Math.max(600, (settings.wideRadius * 1.3) / speed)))
  const query = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lon}`,
    toPlace: `${dest.lat},${dest.lon}`,
    pedestrianSpeed: speed.toFixed(2),
    maxPreTransitTime: String(maxPre),
    maxPostTransitTime: '900',
    searchWindow: '2700',
    numItineraries: '6',
    maxItineraries: '10',
    detailedTransfers: 'false',
    language: 'cs',
  }).toString()
  const data = await fetchPlan(query)
  return { journeys: await parse(data, origin, dest), prev: data.previousPageCursor, next: data.nextPageCursor, query }
}

/** Načte dřívější (`prev`) nebo pozdější (`next`) spojení ke stejnému dotazu. */
export async function morePage(page: JourneyPage, dir: 'prev' | 'next', origin: LatLon & { name?: string }, dest: Place): Promise<JourneyPage> {
  const cursor = page[dir]
  if (!cursor) return page
  const data = await fetchPlan(page.query, cursor)
  const more = await parse(data, origin, dest)
  return {
    query: page.query,
    journeys: mergeJourneys(page.journeys, more),
    prev: dir === 'prev' ? data.previousPageCursor : page.prev,
    next: dir === 'next' ? data.nextPageCursor : page.next,
  }
}

export const transitLegs = (j: Journey) => j.legs.filter((l): l is TransitLeg => l.kind === 'transit')
export const firstWalk = (j: Journey) => (j.legs[0]?.kind === 'walk' ? (j.legs[0] as WalkLeg) : null)
