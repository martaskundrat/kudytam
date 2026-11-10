/**
 * Plánovač: najde odjezdy z nejbližších zastávek a pokud do `thresholdMin` minut
 * nic použitelného nejede, prohledá širší okolí a doporučí lepší spoj
 * (včetně času chůze na vzdálenější zastávku).
 */
import type { Departure, LatLon, Option, Place, Settings, Stop } from '../types'
import { travelMinutes } from './geo'
import { linesAt } from './stations'
import { normalize, type TransitProvider } from './transit'

/** Rezerva na nástup (najít nástupiště, přejít přechod…) */
const BOARDING_BUFFER_MIN = 0.5
/** Max. počet tras (linka + směr + zastávka), které ověřujeme do cíle – Golemio má limit dotazů */
const MAX_PATTERN_CHECKS = 14
const CONCURRENCY = 4
const LOOKAHEAD_MIN = 60
/** Okruh kolem cíle, ve kterém hledáme cílové zastávky */
const DESTINATION_RADIUS = 250
/** Vzdálenější spoj doporučíme, jen když ušetří aspoň tolik minut (chůze navíc se musí vyplatit) */
const MIN_GAIN_MIN = 2

export interface StopGroup {
  name: string
  distance: number
  walkMin: number
  zones: string[]
  options: Option[]
}

export interface Recommendation {
  option: Option
  /** o kolik dřív odjedeš / dorazíš oproti nejlepší možnosti z nejbližších zastávek */
  savedMin: number | null
  basis: 'departure' | 'arrival'
}

export interface PlanResult {
  origin: LatLon
  groups: StopGroup[]
  nearHasSoon: boolean
  wideSearched: boolean
  wideGroups: StopGroup[]
  recommendation: Recommendation | null
  destinationStops: string[]
  fetchedAt: number
}

function toOption(dep: Departure, kmh: number, now: number): Option {
  const walkMin = travelMinutes(dep.stop.distance, kmh)
  const untilDep = (dep.predicted - now) / 60000
  const leaveInMin = untilDep - walkMin - BOARDING_BUFFER_MIN
  return { departure: dep, walkMeters: dep.stop.distance, walkMin, leaveInMin, reachable: leaveInMin >= 0 }
}

function groupByStop(options: Option[], stops: Stop[], kmh: number): StopGroup[] {
  const groups = new Map<string, StopGroup>()
  for (const s of stops) {
    const g = groups.get(s.name)
    if (!g || s.distance < g.distance) {
      groups.set(s.name, {
        name: s.name,
        distance: s.distance,
        walkMin: travelMinutes(s.distance, kmh),
        zones: s.zones,
        options: g?.options ?? [],
      })
    }
  }
  for (const o of options) groups.get(o.departure.stop.name)?.options.push(o)
  return [...groups.values()].sort((a, b) => a.distance - b.distance)
}

/**
 * Ověří, které spoje jedou do cíle. Spoje stejné linky a směru ze stejné zastávky mají
 * stejnou trasu, takže stačí jeden dotaz na skupinu a doba jízdy se přenese na ostatní.
 */
async function enrichWithTarget(
  provider: TransitProvider,
  options: Option[],
  targets: Map<string, string>,
  /** linky zastavující v cíli; prázdné = neznámé, ověřujeme vše */
  destLines: Set<string>,
) {
  const patterns = new Map<string, Option[]>()
  for (const o of options) {
    if (!o.reachable) continue
    // náhradní doprava se značí předponou X (XS7 za S7, X9 za 9)
    const line = o.departure.line
    if (destLines.size && !destLines.has(line) && !destLines.has(line.replace(/^X/, ""))) continue
    const key = [o.departure.line, o.departure.headsign, o.departure.stop.name].join('|')
    patterns.set(key, [...(patterns.get(key) ?? []), o])
  }
  const queue = [...patterns.values()].slice(0, MAX_PATTERN_CHECKS)
  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      const first = group[0]
      try {
        const t = await provider.tripTarget(first.departure, targets)
        if (!t) continue
        const ride = t.arrival - first.departure.predicted
        for (const o of group) o.target = { ...t, arrival: o.departure.predicted + ride }
      } catch {
        /* trasu se nepodařilo ověřit – skupinu přeskočíme */
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return options.filter((o) => o.target)
}

const metric = (o: Option, byArrival: boolean) => (byArrival ? o.target!.arrival : o.departure.predicted)

function best(options: Option[], byArrival: boolean): Option | null {
  let b: Option | null = null
  for (const o of options) {
    if (!o.reachable || o.departure.canceled) continue
    if (byArrival && !o.target) continue
    if (!b || metric(o, byArrival) < metric(b, byArrival)) b = o
  }
  return b
}

export async function plan(
  provider: TransitProvider,
  origin: LatLon,
  destination: Place | null,
  settings: Settings,
  kmh: number,
): Promise<PlanResult> {
  const now = Date.now()
  const [allStops, destStops] = await Promise.all([
    provider.nearbyStops(origin, settings.wideRadius),
    // demo data okolí cíle neznají, tam stačí samotná vybraná stanice
    destination && !provider.isDemo ? provider.nearbyStops(destination, DESTINATION_RADIUS) : Promise.resolve([]),
  ])

  // cílem je vybraná stanice + zastávky v docházkové vzdálenosti od ní (jiný název, např. tramvaj vs. metro)
  const targets = new Map<string, string>()
  if (destination) {
    const name = destination.stopName ?? destination.name
    targets.set(normalize(name), name)
  }
  destStops.forEach((s) => targets.set(normalize(s.name), s.name))

  let nearStops = allStops.filter((s) => s.distance <= settings.nearRadius)
  // když v okruhu nic není, vezmi aspoň 2 nejbližší zastávky
  if (nearStops.length === 0) {
    const names = [...new Set(allStops.map((s) => s.name))].slice(0, 2)
    nearStops = allStops.filter((s) => names.includes(s.name))
  }
  const nearIds = new Set(nearStops.map((s) => s.id))
  const wideStops = allStops.filter((s) => !nearIds.has(s.id))

  const byArrival = !!destination && targets.size > 0
  // předfiltr podle jízdních řádů: trasu ověřujeme jen u linek, které v cíli opravdu staví
  const destLines = byArrival && !provider.isDemo ? await linesAt(targets.values()) : new Set<string>()
  let nearOptions = (await provider.departures(nearStops, LOOKAHEAD_MIN)).map((d) => toOption(d, kmh, now))
  if (byArrival) nearOptions = await enrichWithTarget(provider, nearOptions, targets, destLines)

  const nearHasSoon = nearOptions.some(
    (o) => o.reachable && !o.departure.canceled && (o.departure.predicted - now) / 60000 <= settings.thresholdMin,
  )

  let wideOptions: Option[] = []
  let recommendation: Recommendation | null = null
  const bestNear = best(nearOptions, byArrival)

  if (!nearHasSoon && wideStops.length) {
    wideOptions = (await provider.departures(wideStops, LOOKAHEAD_MIN)).map((d) => toOption(d, kmh, now))
    if (byArrival) wideOptions = await enrichWithTarget(provider, wideOptions, targets, destLines)
    const bestWide = best(wideOptions, byArrival)
    if (bestWide && (!bestNear || metric(bestNear, byArrival) - metric(bestWide, byArrival) >= MIN_GAIN_MIN * 60000)) {
      recommendation = {
        option: bestWide,
        savedMin: bestNear ? Math.round((metric(bestNear, byArrival) - metric(bestWide, byArrival)) / 60000) : null,
        basis: byArrival ? 'arrival' : 'departure',
      }
    }
  }

  return {
    origin,
    groups: groupByStop(nearOptions, nearStops, kmh),
    nearHasSoon,
    wideSearched: !nearHasSoon,
    wideGroups: groupByStop(wideOptions, wideStops, kmh).filter((g) => g.options.length),
    recommendation,
    destinationStops: [...new Set(targets.values())],
    fetchedAt: now,
  }
}
