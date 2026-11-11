/**
 * Vyhledávání spojení s přestupy přes Transitous (MOTIS 2, https://transitous.org).
 * Volá se přes vlastní proxy /api/transitous/plan (kvůli povinnému User-Agentu s kontaktem).
 *
 * Chůze na vzdálenější zastávku je součástí hledání: povolíme první úsek pěšky až do
 * „širšího okolí“, takže vyhledávač sám zváží, jestli se vyplatí dojít dál na rychlejší spoj.
 */
import type { LatLon, Place, Settings, VehicleType } from '../types'
import { distanceM, inCzechia, travelMinutes } from './geo'
import { bikeAreaAt, bikeFromStop, bikesNear, bikeToStop, type BikeOption } from './mobility'
import { platformCodes, platformZones, zonesNear } from './stations'

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
  /** časové pásmo zastávky (IANA) */
  tz?: string
}

export interface WalkLeg {
  kind: 'walk'
  from: LegStop
  to: LegStop
  durationMin: number
  meters: number
  /** úsek sdíleným kolem na začátku nebo konci cesty (pěšky na stojan, kolo, pěšky dál) */
  bike?: BikeOption
  /** kolo na konci cesty: dostupnost ověřená teď, kolo potřebuješ až za chvíli */
  bikeLater?: boolean
  /** Transitous tu počítal s kolem (jen při zpracování, před ověřením) */
  viaBike?: boolean
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
  agencyId?: string
  agencyUrl?: string
  /** odkaz na jízdné / nákup jízdenek z jízdních řádů (GTFS agency_fare_url) */
  agencyFareUrl?: string
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
/** česká železniční stanice podle čísla SR70 v ID zastávky (54xxxxx, 55xxxxx) */
const czStation = (stopId?: string) => /(?:^|\D)5[45]\d{5}(?!\d)/.test(String(stopId ?? ''))

function operatorOf(l: any, vehicle: VehicleType): TransitLeg['operator'] {
  const agency = String(l.agencyName ?? '')
  // odhad ceny ČD jen pro úseky celé v ČR – mezinárodní jízdenky mají jiný ceník
  const domestic = inCzechia(l.from) && inCzechia(l.to)
  if (!domestic) return String(l.from?.stopId ?? '').startsWith('cz-PID_') ? 'pid' : 'other'
  if (CD_NAME.test(agency)) return 'cd'
  if (String(l.from?.stopId ?? '').startsWith('cz-PID_')) return 'pid'
  // mezinárodní vlaky ZSSK / ÖBB mezi českými stanicemi (SR70 54…/55…) jedou v ČR v tarifu ČD
  if (vehicle === 'train' && /slovensko|ÖBB|österreich/i.test(agency) && czStation(l.from?.stopId) && czStation(l.to?.stopId)) return 'cd'
  // vlak z celostátních dat bez uvedeného dopravce – v ČR nejčastěji ČD
  if (vehicle === 'train' && !agency) return 'cd'
  return 'other'
}
/** dopravci, u kterých jízdenka PID neplatí ani na území PID */
const NON_PID_AGENCY = /flixbus|regiojet|student agency|leo ?express|železničná spoločnosť slovensko|ÖBB|deutsche bahn/i
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
    tz: p.tz ?? undefined,
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
  j.legs.map((l) => (l.kind === 'transit' ? `${l.line}@${l.from.scheduled}` : l.bike ? `b:${l.bike.systemId}` : 'w')).join('|')

/** Sloučí spojení (např. z více stránek), bez duplicit, seřazená podle odjezdu. */
export function mergeJourneys(...lists: Journey[][]): Journey[] {
  const map = new Map<string, Journey>()
  for (const list of lists) for (const j of list) map.set(j.id, j)
  return [...map.values()].sort((a, b) => a.start - b.start || a.end - b.end)
}

async function parse(data: any, origin: LatLon & { name?: string }, dest: Place): Promise<Journey[]> {
  const zonesOf = await platformZones()
  const zonesAt = await zonesNear()
  // nástupiště PID tam, kde ho Transitous neposlal (podle GTFS ID z data.pid.cz)
  const codeOf = await platformCodes().catch(() => () => undefined)

  const journeys: Journey[] = (data.itineraries ?? []).map((it: any, i: number): Journey => {
    const legs: Leg[] = (it.legs ?? []).map((l: any): Leg => {
      const from = stopOf(l.from, 'departure')
      const to = stopOf(l.to, 'arrival')
      for (const s of [from, to]) if (!s.track && s.gtfsId) s.track = codeOf(s.gtfsId)
      const durationMin = Math.round((l.duration ?? (to.time - from.time) / 1000) / 60)
      if (l.mode === 'WALK' || l.mode === 'BIKE' || l.mode === 'CAR') {
        return { kind: 'walk', from, to, durationMin, meters: Math.round(l.distance ?? 0), viaBike: l.mode === 'BIKE' || undefined }
      }
      const ids = [l.from?.stopId, ...(l.intermediateStops ?? []).map((s: any) => s.stopId), l.to?.stopId].map(gtfsOf)
      const zones = new Set<string>()
      for (const id of ids) if (id) zonesOf(id)?.forEach((z) => zones.add(z))
      let pid = zones.size > 0
      if (!zones.size) {
        // úsek z jiné datové sady (např. vlak v celostátních datech) – pásma podle polohy zastávek
        for (const p of [l.from, ...(l.intermediateStops ?? []), l.to]) zonesAt(p)?.forEach((z) => zones.add(z))
        // na jízdenku PID jen tehdy, když úsek začíná i končí v PID (rychlík do Brna jen projíždí pásma)
        pid = !!zonesAt(l.from)?.length && !!zonesAt(l.to)?.length
      }
      // komerční dálkoví dopravci jízdenky PID neuznávají
      if (NON_PID_AGENCY.test(`${l.agencyName ?? ''} ${l.from?.stopId ?? ''}`)) pid = false
      if (!pid) zones.clear()
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
        isPid: pid,
        agency: l.agencyName ?? '',
        agencyId: l.agencyId ?? undefined,
        agencyUrl: l.agencyUrl ?? undefined,
        agencyFareUrl: l.agencyFareUrl ?? undefined,
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

/** Kdy jet: odjezd v / příjezd do zvoleného času. Bez něj = odjezd teď. */
export interface When {
  at: number
  arriveBy: boolean
}

/**
 * Kdy vyrazit na přímou cestu (pěšky, kolo, taxi) trvající `durMin`: teď, ve zvolený čas odjezdu,
 * nebo tak, abys byl v cíli do zvoleného času příjezdu (ne dřív než teď).
 */
export const leaveAt = (when: When | null | undefined, now: number, durMin: number) =>
  !when ? now : when.arriveBy ? Math.max(now, when.at - durMin * 60000) : Math.max(now, when.at)

const whenParams = (when?: When | null): Record<string, string> =>
  when ? { time: new Date(when.at).toISOString(), ...(when.arriveBy ? { arriveBy: 'true' } : {}) } : {}

export async function planJourneys(
  origin: LatLon & { name?: string },
  dest: Place,
  settings: Settings,
  kmh: number,
  when?: When | null,
): Promise<JourneyPage> {
  const speed = kmh / 3.6 // m/s
  const extended = settings.extendedSearch !== false
  // první úsek pěšky smí vést až na zastávky v „širším okolí“ (cesta po ulicích ~1,3× delší)
  const maxPre = Math.min(1800, Math.max(600, (settings.wideRadius * 1.3) / speed))
  const walkTime = Math.round(Math.max(MAX_WALK_MIN * 60, (settings.wideRadius * 1.6) / speed))
  const query = new URLSearchParams({
    ...baseParams(`${origin.lat},${origin.lon}`, dest, kmh, maxPre),
    // i cesta pěšky (do 45 min) – jestli ji nabídnout, rozhoduje aplikace podle vzdálenosti a srovnání s MHD;
    // při rozšířeném vyhledávání i autem (taxi)
    ...whenParams(when),
    directModes: extended ? 'WALK,CAR' : 'WALK',
    maxDirectTime: String(extended ? MAX_CAR_S : walkTime),
    // bez toho by Transitous zahodil spojení MHD, která jsou pomalejší než jízda autem
    ...(extended ? { fastestDirectFactor: '100' } : {}),
    searchWindow: '2700',
    numItineraries: '6',
    maxItineraries: '10',
  }).toString()
  // s rozšířeným vyhledáváním zároveň spojení se sdíleným kolem na začátek cesty
  const bikeFirst = extended ? bikeJourneys(origin, dest, kmh, maxPre, settings, when).catch(() => []) : Promise.resolve([])
  const data = await fetchPlan(query)
  const directOf = (mode: string): DirectWalk | undefined => {
    const it = (data.direct ?? []).find((it: any) => (it.legs ?? []).length > 0 && it.legs.every((l: any) => l.mode === mode))
    if (!it) return undefined
    return { durationMin: Math.max(1, Math.round(it.duration / 60)), meters: Math.round(it.legs.reduce((m: number, l: any) => m + (l.distance ?? 0), 0)) }
  }
  const walk = directOf('WALK')
  const regular = await parse(data, origin, dest)
  return {
    journeys: mergeJourneys(regular, worthBiking(await bikeFirst, regular)),
    // delší limit kvůli autu nesmí nabízet delší pěší cesty než dřív
    walk: walk && walk.durationMin * 60 <= walkTime ? walk : undefined,
    car: extended ? directOf('CAR') : undefined,
    prev: data.previousPageCursor,
    next: data.nextPageCursor,
    query,
  }
}

/** nejdelší jízda na kole k zastávce / od zastávky, kterou necháme Transitous zvažovat (s) */
const MAX_BIKE_S = 1200
/** rezerva mezi vrácením kola a odjezdem spoje */
const BIKE_SLACK_MS = 60000

/** kolo na konci cesty potřebuješ až za chvíli – dostupnost ověřená teď je jen orientační */
const BIKE_SURE_MS = 20 * 60000

/**
 * Spojení se sdíleným kolem na začátku a/nebo na konci cesty (Transitous `preTransitModes` /
 * `postTransitModes` = WALK,BIKE – vyhledávač sám zvolí, kde se kolo vyplatí). Jeden dotaz navíc,
 * a jen když je u startu stojan s kolem nebo cíl leží v oblasti systému sdílených kol.
 *
 * Každý úsek na kole se ověří proti živým datům a přepočítá na skutečné stojany:
 * - začátek: kolo na stojanu u startu, volné místo u nástupní zastávky; vyrazit se dá nejdřív teď,
 * - konec: kolo na stojanu u výstupní zastávky, volné místo u cíle. Kolo potřebuješ až po příjezdu,
 *   takže dostupnost ověřená teď je jen pravděpodobná (`bikeLater`).
 * Spojení, kde ověření kola selže, se zahodí – pěší verzi najde běžné hledání.
 */
async function bikeJourneys(
  origin: LatLon & { name?: string },
  dest: Place,
  kmh: number,
  maxPre: number,
  settings: Settings,
  when?: When | null,
): Promise<Journey[]> {
  const [atStart, atEnd] = await Promise.all([bikesNear(origin), bikeAreaAt(dest)])
  if (!atStart && !atEnd) return []
  const query = new URLSearchParams({
    ...baseParams(`${origin.lat},${origin.lon}`, dest, kmh, maxPre),
    ...whenParams(when),
    preTransitModes: atStart ? 'WALK,BIKE' : 'WALK',
    postTransitModes: atEnd ? 'WALK,BIKE' : 'WALK',
    maxPreTransitTime: String(Math.max(maxPre, MAX_BIKE_S)),
    maxPostTransitTime: String(MAX_BIKE_S),
    searchWindow: '2700',
    numItineraries: '5',
    maxItineraries: '8',
  }).toString()
  const walkKmh = Math.min(kmh, 6.5)
  const rider = { category: settings.category, coupons: settings.coupons }
  const out: Journey[] = []
  for (const j of await parse(await fetchPlan(query), origin, dest)) {
    const rides = transitLegs(j)
    const firstRide = rides[0]
    const lastRide = rides[rides.length - 1]
    let legs = [...j.legs]
    let start = j.start
    let end = j.end

    const first = legs[0]
    if (first?.kind === 'walk' && first.viaBike) {
      const bike = await bikeToStop(origin, first.to, walkKmh, rider)
      if (!bike) continue // bez kola u startu nemá spojení smysl – pěší verzi najde běžné hledání
      const walk = walkInstead(origin, first.to, walkKmh)
      if (walk.durationMin <= bike.totalMin + BIKE_SLACK_MS / 60000) {
        // ke stojanům a zpět je to delší než dojít rovnou pěšky
        start = firstRide.from.time - walk.durationMin * 60000
        legs[0] = { ...first, ...walk, viaBike: false }
      } else {
        start = firstRide.from.time - BIKE_SLACK_MS - bike.totalMin * 60000
        legs[0] = {
          ...first,
          durationMin: bike.totalMin,
          meters: bike.from.walkM + bike.rideM + bike.to.walkM,
          bike,
          bikeLater: start - Date.now() > BIKE_SURE_MS,
        }
      }
      if (start < Date.now() - 30000) continue // na tenhle spoj už nestihneš
    }

    const li = legs.length - 1
    const last = legs[li]
    if (last?.kind === 'walk' && last.viaBike && li > 0) {
      const bike = await bikeFromStop(last.from, dest, walkKmh, rider)
      const walk = walkInstead(last.from, dest, walkKmh)
      if (bike && walk.durationMin <= bike.totalMin) {
        // ze zastávky je to pěšky rychlejší než přes stojany kol
        end = lastRide.to.time + walk.durationMin * 60000
        legs[li] = { ...last, ...walk, viaBike: false }
      } else if (bike) {
        end = lastRide.to.time + bike.totalMin * 60000
        legs[li] = {
          ...last,
          durationMin: bike.totalMin,
          meters: bike.from.walkM + bike.rideM + bike.to.walkM,
          bike,
          bikeLater: lastRide.to.time - Date.now() > BIKE_SURE_MS,
        }
      } else continue // u výstupní zastávky není kolo – pěší verzi najde běžné hledání
    }

    // bez žádného úseku na kole je to jen běžné spojení – to najde běžné hledání
    if (!legs.some((l) => l.kind === 'walk' && l.bike)) continue
    legs = legs.map((l) => (l.kind === 'walk' ? { ...l, viaBike: undefined } : l))
    const bj: Journey = { ...j, legs, start, end, durationMin: Math.round((end - start) / 60000) }
    bj.id = journeyKey(bj)
    out.push(bj)
  }
  return out
}

/** chůze místo kola: odhad podle vzdálenosti (po ulicích ~1,3× vzdušné čáry) */
function walkInstead(a: LatLon, b: LatLon, walkKmh: number) {
  const air = distanceM(a, b)
  return { durationMin: Math.max(1, Math.round(travelMinutes(air, walkKmh))), meters: Math.round(air * 1.3) }
}

/**
 * Spojení s kolem nech jen tam, kde se vyplatí: žádné běžné spojení nedorazí stejně brzy
 * nebo dřív a zároveň nevyráží stejně pozdě nebo později.
 */
const worthBiking = (bike: Journey[], regular: Journey[]) =>
  bike.filter((b) => !regular.some((r) => r.end <= b.end && r.start >= b.start))

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
 * Jiný spoj na jednom úseku spojení (jako v IDOSu): `next` = pozdější odjezd, `prev` = dřívější,
 * který ale po předchozím úseku ještě stihneš. Úseky MHD před ním zůstanou, zbytek cesty se přepočítá.
 *
 * Hledá se od místa, kde vystoupíš z předchozího spoje (u prvního úseku od výchozího místa), takže
 * chůze na přestup se spočítá znovu a nahradí tu původní – nesčítá se (nový spoj může jet z jiného nástupiště).
 * Přednost mají spoje ze stejné zastávky jako původní úsek. Vrací null, pokud jiný spoj neexistuje.
 */
export async function shiftLeg(j: Journey, legIndex: number, dir: 'prev' | 'next', dest: Place, kmh: number): Promise<Journey | null> {
  const leg = j.legs[legIndex]
  if (leg?.kind !== 'transit') return null
  const prefix = j.legs.slice(0, legIndex)
  const lastIdx = prefix.map((l) => l.kind).lastIndexOf('transit')
  const prev = lastIdx >= 0 ? (prefix[lastIdx] as TransitLeg) : null
  // úseky, které zůstanou beze změny: jen do posledního spoje MHD (bez přestupní chůze za ním)
  const keep = prev ? prefix.slice(0, lastIdx + 1) : []
  const walkBefore = sumWalkMs(prefix.slice(lastIdx + 1))
  const dep = leg.from.time

  // odkud hledat: zastávka výstupu z předchozího spoje, nebo výchozí místo
  const origin = prev ? prev.to : (prefix[0]?.from ?? leg.from)
  // od přesné polohy (ne od ID stanice) – Transitous jinak bere všechna nástupiště stanice jako jedno místo
  // a chůzi na přestup vynechá
  const fromPlace = `${origin.lat},${origin.lon}`
  // nejdřív můžeš vyrazit: po příjezdu předchozím spojem, u prvního úseku teď
  const earliest = prev ? prev.to.time : Date.now()

  let time: number
  let windowS: number
  if (dir === 'next') {
    time = Math.max(earliest, dep - walkBefore + SAME_TRIP_MS)
    windowS = 3600
  } else {
    // dřívější spoj nestihneš už ani s dosavadní chůzí
    if (earliest + walkBefore >= dep - SAME_TRIP_MS) return null
    time = earliest
    windowS = Math.max(60, Math.round((dep - earliest) / 1000))
  }
  // přestup: chůze na jiné nástupiště / blízkou zastávku; z výchozího místa jako původně
  const maxPre = prev ? 600 : Math.max(600, Math.round((walkBefore / 1000) * 2))
  const query = new URLSearchParams({
    ...baseParams(fromPlace, dest, kmh, maxPre),
    time: new Date(time).toISOString(),
    searchWindow: String(windowS),
    numItineraries: '5',
    maxItineraries: '10',
  }).toString()
  const data = await fetchPlan(query)
  const cands = await parse(data, { lat: origin.lat, lon: origin.lon, name: origin.name || 'Výchozí místo' }, dest)
  const firstRide = (c: Journey) => transitLegs(c)[0]
  const firstDep = (c: Journey) => firstRide(c)?.from.time ?? c.start
  const ok =
    dir === 'next'
      ? cands.filter((c) => firstDep(c) > dep + SAME_TRIP_MS - 1000)
      : cands.filter((c) => firstDep(c) < dep - SAME_TRIP_MS + 1000 && c.start >= time - 1000)
  const sameStop = ok.filter((c) => firstRide(c)?.from.name === leg.from.name)
  const pool = sameStop.length ? sameStop : ok
  const pick = pool.sort((a, b) => (dir === 'next' ? firstDep(a) - firstDep(b) : firstDep(b) - firstDep(a)) || a.end - b.end)[0]
  if (!pick) return null

  const legs = [...keep, ...pick.legs]
  const start = prev ? j.start : pick.start
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
  tz?: string
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
        tz: p.tz ?? undefined,
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
