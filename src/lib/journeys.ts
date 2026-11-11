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
  /** ID zastávky v Transitous (např. "cz-PID_U1040Z102P") – pro hledání odtud */
  stopId?: string
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
  agencyUrl?: string
  /** dopravce pro účely jízdného: vlaky PID (S, R) jezdí převážně ČD */
  operator: 'pid' | 'cd' | 'other'
  tripId?: string
  /** body trasy (nástup, mezilehlé zastávky, výstup) – pro odhad vzdálenosti */
  points: LatLon[]
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
const CD_NAME = /(č|c)esk(é|e) dr(á|a)hy/i
function operatorOf(l: any, vehicle: VehicleType): TransitLeg['operator'] {
  const agency = String(l.agencyName ?? '')
  if (CD_NAME.test(agency)) return 'cd'
  if (String(l.from?.stopId ?? '').startsWith('cz-PID_')) return 'pid'
  // vlak z celostátních dat bez uvedeného dopravce – v ČR nejčastěji ČD
  if (vehicle === 'train' && !agency) return 'cd'
  return 'other'
}
const PID_PREFIX = 'cz-PID_'
const gtfsOf = (stopId?: string) => (stopId?.startsWith(PID_PREFIX) ? stopId.slice(PID_PREFIX.length) : undefined)

function stopOf(p: any, at: 'departure' | 'arrival'): LegStop {
  const t = Date.parse(p[at] ?? p.departure ?? p.arrival)
  const s = Date.parse(p[at === 'departure' ? 'scheduledDeparture' : 'scheduledArrival'] ?? p[at])
  return {
    name: p.name === 'START' || p.name === 'END' ? '' : p.name,
    stopId: p.stopId ?? undefined,
    gtfsId: gtfsOf(p.stopId),
    lat: p.lat,
    lon: p.lon,
    time: t,
    scheduled: Number.isNaN(s) ? t : s,
    track: p.track ?? p.scheduledTrack ?? undefined,
  }
}

/** nejdelší cesta pěšky, kterou nabízíme jako alternativu k MHD */
export const MAX_WALK_MIN = 45

/** Cesta celá pěšky (Transitous `direct`) */
export interface DirectWalk {
  durationMin: number
  meters: number
}

export interface JourneyPage {
  journeys: Journey[]
  /** cesta pěšky, pokud je cíl v dosahu */
  walk?: DirectWalk
  /** jízda autem (pro taxi) – jen při rozšířeném vyhledávání */
  car?: DirectWalk
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
        agencyUrl: l.agencyUrl ?? undefined,
        operator: operatorOf(l, MODE[l.mode] ?? 'other'),
        tripId: l.tripId ?? undefined,
        points: [l.from, ...(l.intermediateStops ?? []), l.to].map((p: any) => ({ lat: p.lat, lon: p.lon })),
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

function baseParams(from: string, dest: Place, kmh: number, maxPre: number) {
  return {
    fromPlace: from,
    toPlace: `${dest.lat},${dest.lon}`,
    pedestrianSpeed: (kmh / 3.6).toFixed(2),
    maxPreTransitTime: String(Math.round(maxPre)),
    maxPostTransitTime: '900',
    detailedTransfers: 'false',
    language: 'cs',
  }
}

/** nejdelší jízda autem, kterou počítáme při rozšířeném vyhledávání (taxi) */
const MAX_CAR_S = 2 * 3600

export async function planJourneys(origin: LatLon & { name?: string }, dest: Place, settings: Settings, kmh: number): Promise<JourneyPage> {
  const speed = kmh / 3.6 // m/s
  const extended = settings.extendedSearch !== false
  // první úsek pěšky smí vést až na zastávky v „širším okolí“ (cesta po ulicích ~1,3× delší)
  const maxPre = Math.min(1800, Math.max(600, (settings.wideRadius * 1.3) / speed))
  const walkTime = Math.round(Math.max(MAX_WALK_MIN * 60, (settings.wideRadius * 1.6) / speed))
  const query = new URLSearchParams({
    ...baseParams(`${origin.lat},${origin.lon}`, dest, kmh, maxPre),
    // i cesta pěšky (do 45 min) – jestli ji nabídnout, rozhoduje aplikace podle vzdálenosti a srovnání s MHD;
    // při rozšířeném vyhledávání i autem (taxi)
    directModes: extended ? 'WALK,CAR' : 'WALK',
    maxDirectTime: String(extended ? MAX_CAR_S : walkTime),
    // bez toho by Transitous zahodil spojení MHD, která jsou pomalejší než jízda autem
    ...(extended ? { fastestDirectFactor: '100' } : {}),
    searchWindow: '2700',
    numItineraries: '6',
    maxItineraries: '10',
  }).toString()
  const data = await fetchPlan(query)
  const directOf = (mode: string): DirectWalk | undefined => {
    const it = (data.direct ?? []).find((it: any) => (it.legs ?? []).length > 0 && it.legs.every((l: any) => l.mode === mode))
    if (!it) return undefined
    return { durationMin: Math.max(1, Math.round(it.duration / 60)), meters: Math.round(it.legs.reduce((m: number, l: any) => m + (l.distance ?? 0), 0)) }
  }
  const walk = directOf('WALK')
  return {
    journeys: await parse(data, origin, dest),
    // delší limit kvůli autu nesmí nabízet delší pěší cesty než dřív
    walk: walk && walk.durationMin * 60 <= walkTime ? walk : undefined,
    car: extended ? directOf('CAR') : undefined,
    prev: data.previousPageCursor,
    next: data.nextPageCursor,
    query,
  }
}

/** Načte dřívější (`prev`) nebo pozdější (`next`) spojení ke stejnému dotazu. */
export async function morePage(page: JourneyPage, dir: 'prev' | 'next', origin: LatLon & { name?: string }, dest: Place): Promise<JourneyPage> {
  const cursor = page[dir]
  if (!cursor) return page
  const data = await fetchPlan(page.query, cursor)
  const more = await parse(data, origin, dest)
  return {
    query: page.query,
    walk: page.walk,
    car: page.car,
    journeys: mergeJourneys(page.journeys, more),
    prev: dir === 'prev' ? data.previousPageCursor : page.prev,
    next: dir === 'next' ? data.nextPageCursor : page.next,
  }
}

/** Rezerva, aby „pozdější“ nebyl tentýž spoj a „dřívější“ nebyl na hraně */
const SAME_TRIP_MS = 30000
const sumWalkMs = (legs: Leg[]) => legs.reduce((t, l) => t + (l.kind === 'walk' ? l.durationMin * 60000 : 0), 0)

/**
 * Jiný spoj na jednom úseku spojení (jako v IDOSu): `next` = pozdější odjezd z nástupní
 * zastávky úseku, `prev` = dřívější, který ale po předchozím úseku ještě stihneš.
 * Úseky před ním zůstanou, zbytek cesty do cíle se přepočítá.
 * Vrací null, pokud jiný spoj neexistuje.
 */
export async function shiftLeg(j: Journey, legIndex: number, dir: 'prev' | 'next', dest: Place, kmh: number): Promise<Journey | null> {
  const leg = j.legs[legIndex]
  if (leg?.kind !== 'transit' || !leg.from.stopId) return null
  const prefix = j.legs.slice(0, legIndex)
  const lastIdx = prefix.map((l) => l.kind).lastIndexOf('transit')
  const dep = leg.from.time

  let time: number
  let windowS: number
  if (dir === 'next') {
    time = dep + SAME_TRIP_MS
    windowS = 3600
  } else {
    // nejdřívější okamžik, kdy můžeš na zastávce být: po příjezdu předchozím spojem a přestupu,
    // u prvního úseku až po cestě pěšky z výchozího místa (vyrazit dřív než teď nejde)
    const from =
      lastIdx >= 0
        ? (prefix[lastIdx] as TransitLeg).to.time + sumWalkMs(prefix.slice(lastIdx + 1))
        : Date.now() + sumWalkMs(prefix)
    if (from >= dep - SAME_TRIP_MS) return null
    time = from
    windowS = Math.max(60, Math.round((dep - from) / 1000))
  }
  const query = new URLSearchParams({
    ...baseParams(leg.from.stopId, dest, kmh, 300), // ze zastávky jen přechod na jiné nástupiště
    time: new Date(time).toISOString(),
    searchWindow: String(windowS),
    numItineraries: '4',
    maxItineraries: '8',
  }).toString()
  const data = await fetchPlan(query)
  const cands = await parse(data, { lat: leg.from.lat, lon: leg.from.lon, name: leg.from.name }, dest)
  const firstDep = (c: Journey) => transitLegs(c)[0]?.from.time ?? c.start
  const pick =
    dir === 'next'
      ? cands.filter((c) => firstDep(c) > dep + SAME_TRIP_MS - 1000).sort((a, b) => firstDep(a) - firstDep(b) || a.end - b.end)[0]
      : cands
          .filter((c) => firstDep(c) < dep - SAME_TRIP_MS + 1000 && c.start >= time - 1000)
          .sort((a, b) => firstDep(b) - firstDep(a) || a.end - b.end)[0]
  if (!pick) return null

  const legs = [...prefix, ...pick.legs]
  const start = lastIdx >= 0 ? j.start : pick.start - sumWalkMs(prefix)
  const out: Journey = {
    id: '',
    start,
    end: pick.end,
    durationMin: Math.round((pick.end - start) / 60000),
    transfers: Math.max(0, legs.filter((l) => l.kind === 'transit').length - 1),
    legs,
  }
  out.id = journeyKey(out)
  return out
}

export const transitLegs = (j: Journey) => j.legs.filter((l): l is TransitLeg => l.kind === 'transit')
export const firstWalk = (j: Journey) => (j.legs[0]?.kind === 'walk' ? (j.legs[0] as WalkLeg) : null)

/* ---------- celá trasa spoje (seznam zastávek) ---------- */

export interface TripStop {
  name: string
  /** příjezd / odjezd včetně zpoždění */
  arr?: number
  dep?: number
  schedArr?: number
  schedDep?: number
  track?: string
  cancelled: boolean
}

export interface TripDetail {
  stops: TripStop[]
  realTime: boolean
  headsign: string
  fetchedAt: number
}

const ts = (v?: string) => (v ? Date.parse(v) : undefined)

/** Všechny zastávky spoje s aktuálními časy (Transitous /trip). */
export async function fetchTrip(tripId: string): Promise<TripDetail> {
  const res = await fetch(`/api/transitous/trip?tripId=${encodeURIComponent(tripId)}&detailedLegs=false`)
  if (!res.ok) throw new Error(`Trasu spoje se nepodařilo načíst (${res.status}).`)
  const data = await res.json()
  const legs: any[] = data.legs ?? []
  const stops: TripStop[] = []
  for (const l of legs) {
    for (const p of [l.from, ...(l.intermediateStops ?? []), l.to]) {
      const prev = stops[stops.length - 1]
      const stop: TripStop = {
        name: p.name,
        arr: ts(p.arrival),
        dep: ts(p.departure),
        schedArr: ts(p.scheduledArrival),
        schedDep: ts(p.scheduledDeparture),
        track: p.track ?? p.scheduledTrack ?? undefined,
        cancelled: !!p.cancelled,
      }
      // navazující úseky (stay-seated) sdílejí zastávku
      if (prev && prev.name === stop.name) Object.assign(prev, { dep: stop.dep ?? prev.dep, schedDep: stop.schedDep ?? prev.schedDep })
      else stops.push(stop)
    }
  }
  return { stops, realTime: legs.some((l) => l.realTime), headsign: legs[0]?.headsign ?? '', fetchedAt: Date.now() }
}

/** Kde je spoj teď: index poslední projeté zastávky a jestli v ní právě stojí. */
export function tripPosition(stops: TripStop[], now = Date.now()): { lastIdx: number; atStop: boolean } {
  let lastIdx = -1
  let atStop = false
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i].arr ?? stops[i].dep
    const d = stops[i].dep ?? stops[i].arr
    if (a !== undefined && a <= now) {
      lastIdx = i
      atStop = d !== undefined && d > now
    }
  }
  return { lastIdx, atStop }
}
