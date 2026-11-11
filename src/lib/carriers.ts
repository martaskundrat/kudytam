/**
 * Dopravci mimo PID a ČD (celá ČR): rozpoznání dopravce, živá cena a odkaz na nákup u prodejce.
 *
 * - FlixBus: veřejné vyhledávání global.api.flixbus.com (stanice = ID stanic FlixBus z Transitous),
 *   cena konkrétního spoje včetně poplatku; odkaz do e-shopu s předvyplněnou trasou a datem.
 * - RegioJet (vlaky i autobusy, dříve STUDENT AGENCY): veřejné API brn-ybus-pubapi.sa.cz,
 *   cena „od“ (nejlevnější třída) podle tarifu cestujícího; odkaz na regiojet.cz s trasou a datem.
 * - Ostatní (Leo Express, Arriva, ZSSK, krajští dopravci, MHD mimo PID): web dopravce a IDOS
 *   s předvyplněnou trasou a časem – cenu ukáže dopravce.
 *
 * Volá se přes proxy /api/fares/* (netlify/edge-functions/fares.ts).
 */
import { distanceM } from './geo'
import type { TransitLeg } from './journeys'
import type { PassengerCategory } from '../types'

export type CarrierId = 'flixbus' | 'regiojet' | 'leo' | 'arriva' | 'zssk' | 'other'

export interface Carrier {
  id: CarrierId
  name: string
  web?: string
}

const KNOWN: { id: CarrierId; name: string; re: RegExp; web: string }[] = [
  { id: 'flixbus', name: 'FlixBus', re: /flixbus/i, web: 'https://www.flixbus.cz/' },
  { id: 'regiojet', name: 'RegioJet', re: /regiojet|student agency/i, web: 'https://regiojet.cz/' },
  { id: 'leo', name: 'Leo Express', re: /leo ?express/i, web: 'https://www.leoexpress.com/cs' },
  { id: 'arriva', name: 'Arriva', re: /arriva/i, web: 'https://arriva.cz/' },
  { id: 'zssk', name: 'ZSSK', re: /železničná spoločnosť slovensko|zssk/i, web: 'https://www.zssk.sk/' },
]

/** odkaz z dat jízdních řádů, který opravdu vede na web dopravce */
const validWeb = (u?: string) => (u && /^https?:\/\//.test(u) && !/cisjr\.cz|invalid/.test(u) ? u : undefined)

/** „IDS JMK (Data from: KORDIS JMK, DPMB)“ → „IDS JMK“ */
const cleanName = (n: string) => n.replace(/s*((data|daten)[^)]*)s*$/i, '').trim()

export function carrierOf(l: TransitLeg): Carrier {
  const text = `${l.agency} ${l.agencyId ?? ''} ${l.from.stopId ?? ''}`
  const k = KNOWN.find((c) => c.re.test(text))
  if (k) return { id: k.id, name: k.name, web: k.web }
  return { id: 'other', name: cleanName(l.agency) || 'dopravce', web: validWeb(l.agencyUrl) }
}

export interface CarrierQuote {
  /** cena v Kč (u RegioJetu nejlevnější třída) */
  price: number
  /** „od“ – cena se liší podle třídy / obsazenosti */
  from: boolean
  href: string
  note?: string
}

/** klíč úseku pro předání cen do výpočtu jízdného */
export const legKey = (l: TransitLeg) => `${l.tripId ?? l.line}@${l.from.scheduled}@${l.to.name}`

/** místní datum YYYY-MM-DD */
const isoDate = (t: number) => new Date(t).toLocaleDateString('sv-SE')
const czDate = (t: number) => {
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
/** stejný spoj: odjezd do 2 min od plánovaného */
const sameTime = (a: number, b: number) => Math.abs(a - b) <= 2 * 60000

const memo = new Map<string, Promise<any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
function cached<T>(key: string, load: () => Promise<T>, ttlMs: number): Promise<T> {
  const hit = memo.get(key)
  if (hit) return hit
  const p = load()
  memo.set(key, p)
  p.catch(() => memo.delete(key))
  setTimeout(() => memo.delete(key), ttlMs)
  return p
}
const getJson = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------- FlixBus ---------- */

const flixStation = (stopId?: string) => stopId?.match(/flixbus_([0-9a-f-]{36})/i)?.[1]

async function flixQuote(l: TransitLeg): Promise<CarrierQuote | null> {
  const from = flixStation(l.from.stopId)
  const to = flixStation(l.to.stopId)
  if (!from || !to) return null
  const date = czDate(l.from.scheduled)
  const q = new URLSearchParams({
    from_station_id: from,
    to_station_id: to,
    departure_date: date,
    products: JSON.stringify({ adult: 1 }),
    currency: 'CZK',
    locale: 'cs',
    search_by: 'stations',
    include_after_midnight_rides: '1',
  })
  // jeden dotaz vrátí všechny spoje dne pro dvojici stanic – sdílí se mezi spojeními
  const data = await cached(`flix:${from}:${to}:${date}`, () => getJson(`/api/fares/flixbus/search?${q}`), 5 * 60000)
  const results: any[] = (data.trips ?? []).flatMap((t: any) => Object.values(t.results ?? {}))
  const r = results.find(
    (r) => r.departure?.station_id === from && r.arrival?.station_id === to && sameTime(Date.parse(r.departure.date), l.from.scheduled),
  )
  if (!r || r.status !== 'available') return null
  const shop = new URLSearchParams({
    departureCity: r.departure.city_id,
    arrivalCity: r.arrival.city_id,
    departureStation: from,
    arrivalStation: to,
    rideDate: date,
    adult: '1',
    _locale: 'cs',
  })
  return {
    price: Math.round(r.price?.total_with_platform_fee ?? r.price?.total),
    from: false,
    href: `https://shop.flixbus.cz/search?${shop}`,
    note: 'Cena FlixBusu pro dospělého včetně poplatku za rezervaci; cena se mění s obsazeností.',
  }
}

/* ---------- RegioJet ---------- */

const RJ_TARIFF: Record<PassengerCategory, string> = {
  adult: 'REGULAR',
  student: 'CZECH_STUDENT_PASS_26',
  junior: 'CZECH_STUDENT_PASS_15',
  child: 'CHILD_UNDER_12',
  senior60: 'REGULAR',
  senior65: 'ISIC', // v číselníku RegioJetu: „Senior od 65 let“
  ztp: 'DISABLED',
}

interface RjStation {
  id: number
  lat: number
  lon: number
  sr70?: string
  train: boolean
}

const rjStations = () =>
  cached(
    'rj:locations',
    async (): Promise<RjStation[]> => {
      const data: any[] = await getJson('/api/fares/regiojet/locations')
      return data.flatMap((country) =>
        (country.cities ?? []).flatMap((c: any) =>
          (c.stations ?? []).map((s: any) => ({
            id: s.id,
            lat: s.latitude,
            lon: s.longitude,
            sr70: s.sr70Number ? String(s.sr70Number) : undefined,
            train: (s.stationsTypes ?? []).includes('TRAIN_STATION'),
          })),
        ),
      )
    },
    24 * 3600000,
  )

/** číslo železniční stanice SR70 z ID zastávky v Transitous (různé datové sady ho zapisují různě) */
function sr70Of(stopId?: string): string | undefined {
  if (!stopId) return undefined
  const full = stopId.match(/(?:^|[^\d])(5[45]\d{5})(?!\d)/)
  if (full) return full[1]
  const czptt = stopId.match(/czptt:stop:CZ:(\d{5})/)
  return czptt ? `54${czptt[1]}` : undefined
}

function rjStationFor(list: RjStation[], p: { lat: number; lon: number; stopId?: string }, train: boolean): RjStation | undefined {
  const sr = train ? sr70Of(p.stopId) : undefined
  if (sr) {
    const hit = list.find((s) => s.sr70 === sr)
    if (hit) return hit
  }
  // autobusy a stanice bez SR70: nejbližší stanice RegioJetu do 500 m
  let best: RjStation | undefined
  let bestD = 500
  for (const s of list) {
    if (s.train !== train) continue
    const d = distanceM(p, s)
    if (d < bestD) [best, bestD] = [s, d]
  }
  return best
}

async function regiojetQuote(l: TransitLeg, category: PassengerCategory): Promise<CarrierQuote | null> {
  const list = await rjStations()
  const train = l.vehicle === 'train'
  const a = rjStationFor(list, l.from, train)
  const b = rjStationFor(list, l.to, train)
  if (!a || !b || a.id === b.id) return null
  const tariff = RJ_TARIFF[category]
  const params = {
    fromLocationId: String(a.id),
    fromLocationType: 'STATION',
    toLocationId: String(b.id),
    toLocationType: 'STATION',
    departureDate: isoDate(l.from.scheduled),
    tariffs: tariff,
  }
  const q = new URLSearchParams(params)
  const data = await cached(`rj:${q}`, () => getJson(`/api/fares/regiojet/routes?${q}`), 5 * 60000)
  const r = (data.routes ?? []).find((r: any) => r.transfersCount === 0 && sameTime(Date.parse(r.departureTime), l.from.scheduled))
  if (!r || typeof r.priceFrom !== 'number') return null
  return {
    price: Math.round(r.priceFrom),
    from: r.priceTo > r.priceFrom,
    href: `https://regiojet.cz/?${new URLSearchParams(params)}`,
    note: r.bookable === false ? 'Spoj se nedá rezervovat online – jízdenku koupíš u řidiče / ve vlaku.' : r.freeSeatsCount === 0 ? 'Spoj je vyprodaný.' : undefined,
  }
}

/** Živá cena úseku u dopravce, pokud ji dopravce zveřejňuje (jinak null). */
export async function carrierQuote(l: TransitLeg, category: PassengerCategory): Promise<CarrierQuote | null> {
  const c = carrierOf(l)
  try {
    if (c.id === 'flixbus') return await flixQuote(l)
    if (c.id === 'regiojet') return await regiojetQuote(l, category)
  } catch {
    /* výpadek API dopravce nesmí shodit detail spojení */
  }
  return null
}

/** úseky, pro které má smysl ptát se na živou cenu */
export const quotable = (l: TransitLeg) => !l.isPid && l.operator !== 'cd' && ['flixbus', 'regiojet'].includes(carrierOf(l).id)
