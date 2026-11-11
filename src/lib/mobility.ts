/**
 * Rozšířené vyhledávání: sdílená kola (GBFS) a taxi / odvoz přes aplikace.
 *
 * Sdílená kola – živá data GBFS (stanice, volná kola, volná stojany, ceník):
 *   všechny systémy nextbike v ČR (seznam s oblastmi v bike-systems.ts, `npm run bikes`),
 *   https://gbfs.nextbike.net – CC0, CORS povolené. Načte se jen GBFS systému, v jehož oblasti je start i cíl.
 *   Ceníky jednotlivých měst (i minuty zdarma, např. Ostrava) jsou přímo v GBFS system_pricing_plans.
 *
 * Taxi – čas a vzdálenost jízdy autem počítá Transitous (`directModes=CAR`).
 * Cena je ORIENTAČNÍ ROZPĚTÍ: Uber, Bolt ani Liftago nezveřejňují ceník, cenu ukážou až v aplikaci
 * (u Liftaga je cena sjednaná předem). Horní mez = maximální cena taxi v Praze podle cenového výměru
 * hl. m. Prahy č. 3/2026 (70 Kč nástupní + 42 Kč/km), dolní mez je odhad podle běžných cen aplikací.
 */
import { NEXTBIKE_CZ } from './bike-systems'
import { appLink, type AppLink } from './fares'
import { distanceM, travelMinutes } from './geo'
import { isCouponActive } from './tickets'
import type { Coupon, LatLon, PassengerCategory } from '../types'

/* ---------- GBFS ---------- */

interface BikeSystem {
  id: string
  /** značka, jak ji zná uživatel */
  brand: string
  /** město / oblast systému */
  area: string
  gbfs: string
  bbox: [number, number, number, number]
  app: { android: string; ios: string; web: string }
  /** minuty zdarma (podle regionu stanice v GBFS system_regions) */
  freeRides?: FreeRide[]
}

/** Kdo jede – podle kategorie a kupónů z menu */
export interface Rider {
  category: PassengerCategory
  coupons: Coupon[]
}

interface FreeRide {
  /** region_id stanice, kde jízda začíná */
  regions: string[]
  /** musí jízda i skončit ve stejném regionu? */
  endInRegion: boolean
  minutes: number
  applies: (r: Rider) => boolean
  note: string
}

/** nextbike_tg: region_id z GBFS system_regions */
const NB_PRAHA = ['661', '1054'] // Praha, Praha 22
const NB_RICANY = ['736']

/** elektronický předplatní kupón PID na Prahu (Lítačka) */
const hasPragueCoupon = (r: Rider) => r.coupons.some((c) => isCouponActive(c) && (c.type === 'litacka-praha' || c.zones.includes('P')))

const NEXTBIKE_APP = { android: 'de.nextbike', ios: 'https://apps.apple.com/cz/app/nextbike/id504288371', web: 'https://www.nextbikeczech.com/' }

/**
 * Minuty zdarma, které nejsou v ceníku GBFS (akce měst a PID). Ostatní města mají případné
 * minuty zdarma přímo v ceníku GBFS.
 */
const FREE_RIDES: Record<string, FreeRide[]> = {
  nextbike_tg: [
      {
        // https://pid.cz/cykliste-v-pid/sdilena-kola/ – 2× denně 15 min pro předplatitele kupónu na Prahu v Lítačce;
        // jen s kupónem na Prahu zadaným v menu aplikace
        regions: NB_PRAHA,
        endInRegion: true,
        minutes: 15,
        applies: hasPragueCoupon,
        note: 'Prvních 15 min zdarma (2× denně) s kupónem PID na Prahu v Lítačce – účet Lítačky propoj s aplikací nextbike. Jízda musí začít i skončit v Praze.',
      },
      {
        regions: NB_RICANY,
        endInRegion: false,
        minutes: 15,
        applies: () => true,
        note: 'V Říčanech je prvních 15 min jízdy zdarma.',
      },
  ],
}

export const BIKE_SYSTEMS: BikeSystem[] = NEXTBIKE_CZ.map((s) => ({
  id: s.id,
  brand: 'nextbike',
  area: s.name,
  gbfs: s.gbfs,
  bbox: s.bbox,
  app: NEXTBIKE_APP,
  freeRides: FREE_RIDES[s.id],
}))

/** je bod v oblasti systému (rozšířené o docházkovou vzdálenost)? */
const inArea = (sys: BikeSystem, p: LatLon, radius: number) => {
  const dLat = radius / 111320
  const dLon = radius / (111320 * Math.cos((p.lat * Math.PI) / 180))
  const [a, b, c, d] = sys.bbox
  return p.lat >= a - dLat && p.lat <= c + dLat && p.lon >= b - dLon && p.lon <= d + dLon
}

interface GbfsStation {
  id: string
  name: string
  lat: number
  lon: number
  bikes: number
  docks: number
  renting: boolean
  returning: boolean
  virtual: boolean
  /** parkovací místo bez zámků (GBFS bez `capacity`, např. Brno) – kolo se dá vrátit vždy */
  dockless: boolean
  /** odkazy do aplikace přímo na stanici (GBFS rental_uris) */
  uris?: { android?: string; ios?: string; web?: string }
  planId?: string
  regionId?: string
  regionName?: string
}

interface PricingSegment {
  start: number
  rate: number
  interval: number
  end?: number
}
interface PricingPlan {
  plan_id: string
  name: string
  price: number
  per_min_pricing?: PricingSegment[]
}

interface SystemData {
  system: BikeSystem
  stations: GbfsStation[]
  plans: Map<string, PricingPlan>
  fetchedAt: number
}

const GBFS_TTL_MS = 60000
/** starší feed nebereme – kolo už tam být nemusí */
const MAX_DATA_AGE_S = 10 * 60
/** stanice, která se dlouho neozvala, může být mimo provoz */
const MAX_STATION_AGE_S = 2 * 3600
const cache = new Map<string, { at: number; data: Promise<SystemData> }>()

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadSystem(sys: BikeSystem): Promise<SystemData> {
  const get = (feed: string) =>
    fetch(`${sys.gbfs}/${feed}.json`).then((r) => {
      if (!r.ok) throw new Error(`GBFS ${sys.brand} ${feed}: ${r.status}`)
      return r.json()
    })
  const [info, status, plans, free] = await Promise.all([
    get('station_information'),
    get('station_status'),
    get('system_pricing_plans').catch(() => null),
    get('free_bike_status').catch(() => null),
  ])
  // názvy regionů (systém nextbike Praha pokrývá i Říčany)
  const regions = await get('system_regions').catch(() => null)
  const regionName = new Map<string, string>((regions?.data?.regions ?? []).map((r: any) => [r.region_id, r.name]))
  const st = new Map<string, any>((status.data?.stations ?? []).map((s: any) => [s.station_id, s]))
  // Kolo na stojanu musí potvrdit oba feedy: počet ve station_status i konkrétní kola ve free_bike_status
  // (bez rezervovaných a vyřazených). Zastaralá data nebo chybějící seznam kol = žádné kolo.
  const fresh = (d: any) => d && Date.now() / 1000 - (d.last_updated ?? 0) <= MAX_DATA_AGE_S
  const verified = fresh(status) && fresh(free)
  const present = new Map<string, number>()
  // ceník se v GBFS 2.x uvádí u kol – pro stanici vezmeme ceník kol, která na ní stojí (liší se podle regionu)
  const planAt = new Map<string, string>()
  for (const b of free?.data?.bikes ?? []) {
    if (!b.station_id || b.is_reserved || b.is_disabled) continue
    present.set(b.station_id, (present.get(b.station_id) ?? 0) + 1)
    if (b.pricing_plan_id) planAt.set(b.station_id, b.pricing_plan_id)
  }
  const stations: GbfsStation[] = (info.data?.stations ?? []).map((s: any) => {
    const x = st.get(s.station_id) ?? {}
    const recent = !x.last_reported || Date.now() / 1000 - x.last_reported <= MAX_STATION_AGE_S
    return {
      id: s.station_id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      bikes: verified && recent ? Math.min(x.num_bikes_available ?? 0, present.get(s.station_id) ?? 0) : 0,
      docks: x.num_docks_available ?? 0,
      renting: x.is_renting !== false && x.is_installed !== false,
      returning: x.is_returning !== false && x.is_installed !== false,
      virtual: !!s.is_virtual_station,
      dockless: !!s.is_virtual_station || s.capacity === undefined || s.capacity === null,
      uris: s.rental_uris,
      planId: planAt.get(s.station_id),
      regionId: s.region_id ?? undefined,
      regionName: regionName.get(s.region_id),
    }
  })
  return {
    system: sys,
    stations,
    plans: new Map((plans?.data?.plans ?? []).map((p: PricingPlan) => [p.plan_id, p])),
    fetchedAt: Date.now(),
  }
}

/** Data systému; po TTL feedu (60 s) se načtou znovu, aby počty kol odpovídaly skutečnosti. */
function system(sys: BikeSystem): Promise<SystemData> {
  const c = cache.get(sys.id)
  if (c && Date.now() - c.at <= GBFS_TTL_MS) return c.data
  const data = loadSystem(sys)
  data.catch(() => cache.delete(sys.id))
  cache.set(sys.id, { at: Date.now(), data })
  return data
}

/**
 * Cena výpůjčky podle GBFS `per_min_pricing`: sazba `rate` se účtuje na začátku každého
 * intervalu `interval` minut od `start` do `end` (interval 0 = jednorázově).
 */
export function rentalPrice(plan: PricingPlan, minutes: number): number {
  let total = plan.price ?? 0
  for (const s of plan.per_min_pricing ?? []) {
    if (minutes <= s.start) continue
    const end = Math.min(minutes, s.end ?? Infinity)
    total += s.interval > 0 ? Math.ceil((end - s.start) / s.interval) * s.rate : s.rate
  }
  return Math.round(total)
}

/* ---------- sdílené kolo ---------- */

/** průměrná rychlost na sdíleném kole ve městě (těžší kolo, křižovatky) */
const BIKE_KMH = 15
/** nejvýš tolik stanic na každé straně zkoušíme kombinovat */
const CANDIDATES = 8
/** kratší jízdu na kole nenabízíme – to se vyplatí dojít */
const MIN_RIDE_M = 400

export interface BikeOption {
  systemId: string
  brand: string
  area: string
  from: GbfsStation & { walkMin: number; walkM: number }
  to: GbfsStation & { walkMin: number; walkM: number }
  rideMin: number
  rideM: number
  totalMin: number
  price: number | null
  priceLabel?: string
  /** minuty zdarma, které se odečetly od ceny */
  freeMin: number
  freeNote?: string
  open: AppLink
}

const nearest = (list: GbfsStation[], p: LatLon, radius: number) =>
  list
    .map((s) => ({ s, d: distanceM(p, s) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, CANDIDATES)

/** Nejrychlejší dvojice stojanů: kolo na stojanu u `from`, volné místo na stojanu u `to`. */
function bestPair(sys: BikeSystem, data: SystemData, from: LatLon, to: LatLon, walkKmh: number, startRadius: number, endRadius: number, rider: Rider): BikeOption | null {
  const starts = nearest(data.stations.filter((s) => s.renting && s.bikes > 0), from, startRadius)
  const ends = nearest(data.stations.filter((s) => s.returning && (s.docks > 0 || s.dockless)), to, endRadius)
  let best: BikeOption | null = null
  for (const a of starts) {
    for (const b of ends) {
      if (a.s.id === b.s.id) continue
      const air = distanceM(a.s, b.s)
      if (air < MIN_RIDE_M) continue
      const wa = travelMinutes(a.d, walkKmh)
      const wb = travelMinutes(b.d, walkKmh)
      const ride = travelMinutes(air, BIKE_KMH)
      const total = Math.ceil(wa + ride + wb + RENT_MIN)
      if (best && total >= best.totalMin) continue
      const plan = data.plans.get(a.s.planId ?? '') ?? [...data.plans.values()][0]
      const rideMin = Math.max(1, Math.ceil(ride))
      // minuty zdarma podle regionu stanice, kde si kolo půjčíš (v Praze musí jízda i skončit v Praze)
      const free = sys.freeRides?.find(
        (f) => f.regions.includes(a.s.regionId ?? '') && (!f.endInRegion || f.regions.includes(b.s.regionId ?? '')) && f.applies(rider),
      )
      const freeMin = free?.minutes ?? 0
      best = {
        systemId: sys.id,
        brand: sys.brand,
        area: a.s.regionName ?? sys.area,
        from: { ...a.s, walkMin: Math.round(wa), walkM: Math.round(a.d * 1.3) },
        to: { ...b.s, walkMin: Math.round(wb), walkM: Math.round(b.d * 1.3) },
        rideMin,
        rideM: Math.round(air * 1.3),
        totalMin: total,
        // zbytek jízdy nad minuty zdarma podle ceníku poskytovatele
        price: rideMin <= freeMin ? 0 : plan ? rentalPrice(plan, rideMin - freeMin) : null,
        freeMin,
        freeNote: free?.note,
        priceLabel: plan?.name,
        open: appLink(sys.app.android, sys.app.ios, sys.app.web, a.s.uris),
      }
    }
  }
  return best
}

/** minuty na půjčení a vrácení kola */
const RENT_MIN = 1
/** jak daleko smí být stojan s kolem od startu, když kolem jen dojíždíš na zastávku */
export const FEEDER_START_M = 400
/** jak daleko smí být stojan s volným místem od nástupní zastávky */
const FEEDER_END_M = 350

const systemsAt = (p: LatLon, radius: number) => BIKE_SYSTEMS.filter((s) => inArea(s, p, radius))
async function loaded(sys: BikeSystem): Promise<SystemData | null> {
  try {
    return await system(sys)
  } catch {
    return null // výpadek feedu nesmí shodit vyhledávání
  }
}

/**
 * Nejrychlejší cesta sdíleným kolem: dojít na stanici s volným kolem (v „širším okolí“),
 * dojet na stanici s volným stojanem u cíle a dojít. Nabídne se, jen když je rychlejší než chůze.
 */
export async function bikeOptions(origin: LatLon, dest: LatLon, walkKmh: number, radius: number, rider: Rider): Promise<BikeOption[]> {
  const out: BikeOption[] = []
  const walkOnly = travelMinutes(distanceM(origin, dest), walkKmh)
  for (const sys of systemsAt(origin, radius).filter((s) => inArea(s, dest, radius))) {
    const data = await loaded(sys)
    const best = data && bestPair(sys, data, origin, dest, walkKmh, radius, radius, rider)
    if (best && best.totalMin < walkOnly) out.push(best)
  }
  return out
}

/** Leží bod v oblasti některého systému sdílených kol? */
export const bikeAreaAt = async (p: LatLon) => systemsAt(p, FEEDER_START_M).length > 0

/**
 * Sdílené kolo na konec cesty: ze stojanu u výstupní zastávky na stojan u cíle.
 * Počty kol jsou z teď – po příjezdu se mohou lišit.
 */
export async function bikeFromStop(stop: LatLon, dest: LatLon, walkKmh: number, rider: Rider): Promise<BikeOption | null> {
  let best: BikeOption | null = null
  for (const sys of systemsAt(stop, FEEDER_END_M).filter((s) => inArea(s, dest, FEEDER_START_M))) {
    const data = await loaded(sys)
    const b = data && bestPair(sys, data, stop, dest, walkKmh, FEEDER_END_M, FEEDER_START_M, rider)
    if (b && (!best || b.totalMin < best.totalMin)) best = b
  }
  return best
}

/** Je u startu stojan s kolem? (aby se zbytečně nevyhledávala spojení s kolem) */
export async function bikesNear(origin: LatLon): Promise<boolean> {
  for (const sys of systemsAt(origin, FEEDER_START_M)) {
    const data = await loaded(sys)
    if (data?.stations.some((s) => s.renting && s.bikes > 0 && distanceM(origin, s) <= FEEDER_START_M)) return true
  }
  return false
}

/**
 * Sdílené kolo na začátek cesty: ze stojanu u startu na stojan u nástupní zastávky.
 * Vrací null, když u startu není kolo nebo u zastávky volné místo.
 */
export async function bikeToStop(origin: LatLon, stop: LatLon, walkKmh: number, rider: Rider): Promise<BikeOption | null> {
  let best: BikeOption | null = null
  for (const sys of systemsAt(origin, FEEDER_START_M).filter((s) => inArea(s, stop, FEEDER_END_M))) {
    const data = await loaded(sys)
    const b = data && bestPair(sys, data, origin, stop, walkKmh, FEEDER_START_M, FEEDER_END_M, rider)
    if (b && (!best || b.totalMin < best.totalMin)) best = b
  }
  return best
}

/* ---------- taxi ---------- */

/** jak dlouho typicky trvá, než auto přijede */
export const TAXI_PICKUP_MIN = 6
/** cenový výměr hl. m. Prahy č. 3/2026 – maximální cena taxi */
const TAXI_MAX = { base: 70, perKm: 42 }
/** aplikace (Bolt, Uber, Liftago) bývají levnější než maximum; dolní mez rozpětí */
const TAXI_LOW_FACTOR = 0.65
/** kratší jízdu autem nenabízíme */
export const MIN_TAXI_M = 1000

export interface TaxiService {
  id: 'uber' | 'bolt' | 'liftago'
  name: string
  link: AppLink
  /** předvyplní aplikace cíl? jinak se cíl zkopíruje do schránky */
  prefilled: boolean
}

export interface TaxiOption {
  durationMin: number
  meters: number
  arrival: number
  priceLow: number
  priceHigh: number
  services: TaxiService[]
}

const round10 = (n: number) => Math.round(n / 10) * 10

export function taxiPrice(meters: number): { low: number; high: number } {
  const high = TAXI_MAX.base + (TAXI_MAX.perKm * meters) / 1000
  return { low: round10(high * TAXI_LOW_FACTOR), high: round10(high) }
}

/**
 * Uber má veřejný odkaz s předvyplněným nástupem i cílem (https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction);
 * v telefonu otevře aplikaci, jinak web m.uber.com. Bolt a Liftago veřejný odkaz s trasou nemají –
 * otevře se aplikace a cíl se zkopíruje do schránky.
 */
export function taxiOption(
  car: { durationMin: number; meters: number },
  from: LatLon & { name?: string },
  to: LatLon & { name: string },
  now: number,
): TaxiOption | null {
  if (car.meters < MIN_TAXI_M) return null
  const { low, high } = taxiPrice(car.meters)
  const uber =
    'https://m.uber.com/ul/?' +
    new URLSearchParams({
      action: 'setPickup',
      'pickup[latitude]': String(from.lat),
      'pickup[longitude]': String(from.lon),
      'pickup[nickname]': from.name ?? 'Moje poloha',
      'dropoff[latitude]': String(to.lat),
      'dropoff[longitude]': String(to.lon),
      'dropoff[nickname]': to.name,
    })
  return {
    durationMin: car.durationMin,
    meters: car.meters,
    arrival: now + (TAXI_PICKUP_MIN + car.durationMin) * 60000,
    priceLow: low,
    priceHigh: high,
    services: [
      { id: 'uber', name: 'Uber', prefilled: true, link: { href: uber, hint: 'Otevře Uber s předvyplněným nástupem a cílem.' } },
      {
        id: 'bolt',
        name: 'Bolt',
        prefilled: false,
        link: appLink('ee.mtakso.client', 'https://apps.apple.com/cz/app/bolt/id675033630', 'https://bolt.eu/cs-cz/rides/'),
      },
      {
        id: 'liftago',
        name: 'Liftago',
        prefilled: false,
        link: appLink('com.adleritech.app.liftago.passenger', 'https://apps.apple.com/cz/app/liftago/id633928711', 'https://www.liftago.cz/'),
      },
    ],
  }
}
