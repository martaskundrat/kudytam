/**
 * Výpočet, jakou jízdenku si koupit a kolik stojí – podle Tarifu PID od 1. 1. 2026.
 * Aplikace jízdenky neprodává, jen radí.
 * Zdroj: https://pid.cz/neplatvicnezmusis/  ·  https://pid.cz/wp-content/uploads/ke-stazeni/tarif/Tarif_PID_2026-01-01.pdf
 *
 * Zjednodušení: počet pásem u regionálních jízd se počítá ze seznamu projetých pásem
 * (pásmo P se započítává jako PRAGUE_P_WEIGHT pásem). Před ostrým použitím ověř v Tarifu PID.
 */
import type { Coupon, Option, PassengerCategory, Place, Settings } from '../types'
import type { Journey, TransitLeg } from './journeys'

export const PRAGUE_ZONES = ['P', '0', 'B']
const PRAGUE_P_WEIGHT = 2

export const CATEGORY_LABELS: Record<PassengerCategory, string> = {
  adult: 'Dospělý',
  student: 'Student 18–26 let',
  junior: 'Junior 15–18 let',
  child: 'Dítě 6–15 let',
  senior60: 'Senior 60–65 let',
  senior65: 'Senior 65+',
  ztp: 'Držitel ZTP / ZTP-P',
}

type Fare = 'full' | 'reduced' | 'special' | 'free'

/** Praha (P, 0, B): plné jízdné 15–60 let, zlevněné 60–65, zdarma děti do 15, senioři 65+, ZTP */
const PRAGUE_FARE: Record<PassengerCategory, Fare> = {
  adult: 'full',
  student: 'full',
  junior: 'full',
  child: 'free',
  senior60: 'reduced',
  senior65: 'free',
  ztp: 'free',
}

/** Region: plné 18–65, zlevněné děti, junioři, studenti 18–26 a senioři 65+, zvláštní ZTP */
const REGIONAL_FARE: Record<PassengerCategory, Fare> = {
  adult: 'full',
  student: 'reduced',
  junior: 'reduced',
  child: 'reduced',
  senior60: 'full',
  senior65: 'reduced',
  ztp: 'special',
}

/** Ceny podle způsobu nákupu: aplikace PID Lítačka / papírová (automat, předprodej) / SMS */
export interface Prices {
  app: number
  paper: number
  /** SMS jízdenka existuje jen v plném jízdném pro Prahu */
  sms?: number
}

type PragueRow = { validityMin: number; full: Prices; reduced: Prices }
const PRAGUE_TICKETS: PragueRow[] = [
  { validityMin: 30, full: { app: 36, paper: 39, sms: 42 }, reduced: { app: 18, paper: 19 } },
  { validityMin: 90, full: { app: 46, paper: 50, sms: 55 }, reduced: { app: 23, paper: 25 } },
  { validityMin: 24 * 60, full: { app: 140, paper: 150, sms: 150 }, reduced: { app: 70, paper: 75 } },
]

/** [pásma, platnost min, plné app/papír, zlevněné app/papír, zvláštní app/papír] */
type P = [number, number] | null
const REGIONAL_TICKETS: [number, number, P, P, P][] = [
  [2, 15, [24, 26], [12, 13], [6, 6]],
  [3, 30, [36, 39], [18, 19], [9, 9]],
  [4, 60, [48, 52], [24, 26], [12, 13]],
  [5, 90, [60, 65], [30, 32], [15, 16]],
  [6, 120, [72, 78], [36, 39], [18, 19]],
  [7, 150, [84, 91], [42, 45], [21, 22]],
  [8, 180, [96, 104], [48, 52], [24, 26]],
  [9, 180, [108, 117], [54, 58], [27, 29]],
  [10, 180, [120, 130], [60, 65], [30, 32]],
  [11, 180, [132, 143], [66, 71], [33, 35]],
  [12, 180, [144, 156], [72, 78], [36, 39]],
  [13, 180, [156, 169], [78, 84], [39, 42]],
  [15, 180, [180, 195], [90, 97], null],
  [16, 180, [192, 208], null, null],
]

/**
 * Počet pásem k zaplacení. Vnější pásma PID tvoří soustředné prstence (1, 2, 3…),
 * takže jízda projede i pásma, ve kterých nezastaví (např. rychlík R16 Radotín → Beroun).
 * Proto se doplní celý rozsah od nejnižšího po nejvyšší číslo, a když jízda začíná/končí
 * v Praze (P, 0, B), tak od pásma 1. Pásma pokrytá kupónem se nepočítají.
 */
function countZones(uncovered: string[], covered: Set<string>): number {
  const numeric = uncovered.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  const touchesPrague = uncovered.some((z) => PRAGUE_ZONES.includes(z)) || [...covered].some((z) => PRAGUE_ZONES.includes(z))
  const outer = new Set<number>()
  if (numeric.length) {
    const lo = touchesPrague ? 1 : Math.min(...numeric)
    for (let n = lo; n <= Math.max(...numeric); n++) if (!covered.has(String(n))) outer.add(n)
  }
  const inner = uncovered.filter((z) => PRAGUE_ZONES.includes(z)).reduce((n, z) => n + (z === 'P' ? PRAGUE_P_WEIGHT : 1), 0)
  return inner + outer.size
}

export interface TicketProduct {
  /** typ jízdenky, jak ho uvidíš v aplikaci / automatu */
  name: string
  zones: string[]
  validityMin: number
  prices: Prices
  fare: Fare
  prague: boolean
}

export type TicketDecision =
  | { needed: false; reason: string }
  | { needed: true; product: TicketProduct; note?: string }

export function isCouponActive(c: Coupon, at = Date.now()): boolean {
  return new Date(c.validUntil + 'T23:59:59').getTime() >= at
}

export const FARE_LABEL: Record<Fare, string> = { full: 'plnocenná', reduced: 'zlevněná', special: 'zvláštní', free: 'zdarma' }

const validityLabel = (min: number) => (min >= 1440 ? '24 hodin' : `${min} minut`)

/**
 * @param zones pásma, kterými jízda vede (prázdné = předpokládáme Prahu)
 * @param durationMin předpokládaná délka cesty
 */
export function chooseTicket(zones: string[], durationMin: number, category: PassengerCategory, coupons: Coupon[]): TicketDecision {
  const tripZones = zones.length ? [...new Set(zones)] : ['P']
  const active = coupons.filter((c) => isCouponActive(c))
  const covered = new Set(active.flatMap((c) => c.zones))
  const uncovered = tripZones.filter((z) => !covered.has(z))

  if (uncovered.length === 0) {
    const c = active.find((c) => tripZones.every((z) => c.zones.includes(z))) ?? active[0]
    return { needed: false, reason: `Jízdu ti pokrývá kupón ${c.label}.` }
  }

  // --- jízda jen po Praze ---
  if (uncovered.every((z) => PRAGUE_ZONES.includes(z))) {
    const fare = PRAGUE_FARE[category]
    if (fare === 'free') return { needed: false, reason: `${CATEGORY_LABELS[category]} jezdí po Praze zdarma, stačí doklad o nároku.` }
    const t = PRAGUE_TICKETS.find((t) => t.validityMin >= durationMin) ?? PRAGUE_TICKETS[PRAGUE_TICKETS.length - 1]
    return {
      needed: true,
      product: {
        name: `Praha · ${validityLabel(t.validityMin)} · ${FARE_LABEL[fare]}`,
        zones: PRAGUE_ZONES,
        validityMin: t.validityMin,
        prices: fare === 'reduced' ? t.reduced : t.full,
        fare,
        prague: true,
      },
      note: category === 'student' ? 'Studenti mají v Praze slevu jen na předplatní kupóny, jednotlivá jízdenka je plnocenná.' : undefined,
    }
  }

  // --- regionální jízda ---
  const fare = REGIONAL_FARE[category]
  const col = fare === 'reduced' ? 3 : fare === 'special' ? 4 : 2
  const count = Math.max(2, countZones(uncovered, covered))
  const row =
    REGIONAL_TICKETS.find((r) => r[0] >= count && r[1] >= durationMin && r[col] !== null) ?? REGIONAL_TICKETS[REGIONAL_TICKETS.length - 1]
  const [app, paper] = (row[col] as [number, number] | null) ?? (row[2] as [number, number])
  return {
    needed: true,
    product: {
      name: `${row[0]} ${row[0] >= 5 ? 'pásem' : 'pásma'} · ${validityLabel(row[1])} · ${FARE_LABEL[fare]}`,
      zones: uncovered,
      validityMin: row[1],
      prices: { app, paper },
      fare,
      prague: false,
    },
    note: covered.size ? 'Kupón pokrývá část trasy, jízdenka stačí na zbývající pásma.' : undefined,
  }
}

const DEFAULT_TRIP_MIN = 30
const ARRIVAL_BUFFER_MIN = 5

export interface Quote {
  decision: TicketDecision
  durationMin: number
  /** bez známého příjezdu počítáme s výchozí délkou cesty */
  assumedDuration: boolean
}

/** Jakou jízdenku potřebuješ na konkrétní spoj (od nástupu po výstup + rezerva). */
export function quote(option: Option, settings: Settings, destination: Place | null): Quote {
  const t = option.target
  const zones = [...new Set([...option.departure.stop.zones, ...(t?.zones ?? []), ...(t ? (destination?.zones ?? []) : [])])]
  const durationMin = t ? Math.ceil((t.arrival - option.departure.predicted) / 60000) + ARRIVAL_BUFFER_MIN : DEFAULT_TRIP_MIN
  return { decision: chooseTicket(zones, durationMin, settings.category, settings.coupons), durationMin, assumedDuration: !t }
}

const JOURNEY_BUFFER_MIN = 2

export interface JourneyQuote extends Quote {
  /** úseky mimo PID – na ně je potřeba jízdenka dopravce */
  nonPid: TransitLeg[]
}

/**
 * Jízdenka na celé spojení i s přestupy. Přestupní jízdenka PID platí po celou dobu
 * od prvního nástupu po poslední výstup, ve všech projetých pásmech.
 */
export function quoteJourney(j: Journey, settings: Settings): JourneyQuote {
  const legs = j.legs.filter((l): l is TransitLeg => l.kind === 'transit')
  const pid = legs.filter((l) => l.isPid)
  const nonPid = legs.filter((l) => !l.isPid)
  const zones = [...new Set(pid.flatMap((l) => l.zones))]
  const first = pid[0]?.from.time ?? j.start
  const last = pid[pid.length - 1]?.to.time ?? j.end
  const durationMin = Math.ceil((last - first) / 60000) + JOURNEY_BUFFER_MIN
  if (!pid.length) return { decision: { needed: false, reason: 'Spojení nevede po síti PID – jízdenku kup u dopravce.' }, durationMin, assumedDuration: false, nonPid }
  return { decision: chooseTicket(zones, durationMin, settings.category, settings.coupons), durationMin, assumedDuration: false, nonPid }
}

export const ALL_ZONES = ['P', '0', 'B', '1', '2', '3', '4', '5', '6', '7', '8', '9']
