/**
 * Porovnání jízdného na celé spojení: jízdenka PID (aplikace / papírová / SMS)
 * vs. vlaky na jízdenku ČD a zbytek cesty s PID. Nejlevnější varianta je první.
 *
 * Ceny PID jsou podle Tarifu PID 2026 (viz tickets.ts).
 * Ceny ČD jsou ORIENTAČNÍ ODHAD: ČD nemá veřejné API ani strojově čitelný ceník,
 * proto se interpoluje z cen pro vybrané vzdálenosti, které ČD zveřejnily k jízdnímu
 * řádu 2026 (25 km 68 Kč, 100 km 221 Kč, 250 km 527 Kč). Přesnou cenu ukáže e-shop ČD.
 */
import { carrierOf, legKey, type CarrierQuote } from './carriers'
import { distanceM } from './geo'
import type { Journey, Leg, TransitLeg } from './journeys'
import { chooseTicket, type TicketDecision } from './tickets'
import type { PassengerCategory, Settings } from '../types'

/* ---------- odkazy na nákup ---------- */

const LITACKA_ANDROID = 'cz.dpp.praguepublictransport'
const LITACKA_IOS = 'https://apps.apple.com/cz/app/pid-litacka/id983071129'
const LITACKA_WEB = 'https://pid.cz/aplikace-pid-litacka/'
export const CD_ESHOP = 'https://www.cd.cz/eshop/'

type Platform = 'android' | 'ios' | 'other'
export const platform = (): Platform => {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return 'other'
}

export interface AppLink {
  href: string
  hint: string
}

/**
 * Odkaz, který otevře mobilní aplikaci.
 * Android: intent spustí nainstalovanou aplikaci, jinak otevře Google Play.
 * iOS: bez veřejného odkazu do aplikace se otevře App Store s tlačítkem „Otevřít“.
 * `direct` = odkaz přímo do aplikace (např. na stanici kol), když ho služba zveřejňuje.
 */
export function appLink(androidPackage: string, iosStore: string, web: string, direct?: { android?: string; ios?: string; web?: string }): AppLink {
  switch (platform()) {
    case 'android':
      if (direct?.android) return { href: direct.android, hint: 'Otevře aplikaci (nebo web, pokud ji nemáš).' }
      return {
        href: `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(`https://play.google.com/store/apps/details?id=${androidPackage}`)};end`,
        hint: 'Otevře aplikaci (nebo Google Play, pokud ji nemáš).',
      }
    case 'ios':
      if (direct?.ios) return { href: direct.ios, hint: 'Otevře aplikaci (nebo web, pokud ji nemáš).' }
      return { href: iosStore, hint: 'Otevře App Store – pokud aplikaci máš, klepni na „Otevřít“.' }
    default:
      return { href: direct?.web ?? web, hint: 'Na počítači se otevře web služby.' }
  }
}

/** Otevře aplikaci PID Lítačka (konkrétní jízdenku předvybrat zvenčí nejde). */
export function litackaLink(): AppLink {
  return appLink(LITACKA_ANDROID, LITACKA_IOS, LITACKA_WEB)
}

/* ---------- ČD – odhad ---------- */

/**
 * [km, Kč] – body z ceníku ČD 2026; mezi nimi lineární interpolace.
 * Bod pro 1 km NENÍ z ceníku – je to extrapolace sklonu mezi 25 a 100 km (odhad minimální ceny).
 */
const CD_POINTS: [number, number][] = [
  [1, 20],
  [25, 68],
  [100, 221],
  [250, 527],
]
/** státní sleva 2026: děti 6–18, studenti 18–26 (denní studium), senioři 65+ */
const CD_DISCOUNT: Record<PassengerCategory, number> = {
  adult: 0,
  student: 0.5,
  junior: 0.5,
  child: 0.5,
  senior60: 0,
  senior65: 0.5,
  ztp: 0.5,
}
/** koleje nevedou vzdušnou čarou mezi zastávkami */
const RAIL_FACTOR = 1.08

export function cdFareEstimate(km: number, category: PassengerCategory): number {
  const k = Math.max(1, km)
  let price: number
  const last = CD_POINTS[CD_POINTS.length - 1]
  if (k >= last[0]) {
    const prev = CD_POINTS[CD_POINTS.length - 2]
    price = last[1] + ((k - last[0]) * (last[1] - prev[1])) / (last[0] - prev[0])
  } else {
    const i = CD_POINTS.findIndex(([d]) => d >= k)
    const [d0, p0] = CD_POINTS[Math.max(0, i - 1)]
    const [d1, p1] = CD_POINTS[i]
    price = d1 === d0 ? p1 : p0 + ((k - d0) * (p1 - p0)) / (d1 - d0)
  }
  return Math.round(price * (1 - CD_DISCOUNT[category]))
}

const legKm = (l: TransitLeg) => {
  let m = 0
  for (let i = 1; i < l.points.length; i++) m += distanceM(l.points[i - 1], l.points[i])
  return (m / 1000) * RAIL_FACTOR
}

/* ---------- varianty ---------- */

export interface BuyAction {
  label: string
  href: string
  hint?: string
  /** text, který se při klepnutí zkopíruje do schránky (např. stanice pro e-shop ČD) */
  copy?: string
  primary?: boolean
}

/**
 * IDOS s předvyplněnou trasou a časem (parametry f/t/date/time přijímá v URL).
 * E-shop ČD ani aplikace Lítačka předvyplnění zvenčí neumožňují.
 */
export function idosLink(from: string, to: string, at: number): string {
  const d = new Date(at)
  const date = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
  const time = d.toTimeString().slice(0, 5)
  const q = new URLSearchParams({ f: from, fc: '1', t: to, tc: '1', date, time })
  return `https://idos.cz/vlakyautobusymhdvse/spojeni/vysledky/?${q}`
}

export interface FarePart {
  /** co je to za jízdenku */
  title: string
  /** na které úseky */
  covers: string
  price: number | null
  estimated?: boolean
  /** cena „od“ (nejlevnější třída / tarif) */
  priceFrom?: boolean
  buy: BuyAction[]
  note?: string
}

export interface FareOption {
  id: string
  label: string
  parts: FarePart[]
  /** součet známých cen */
  total: number
  /** některou část nejde nacenit (jiný dopravce) */
  incomplete: boolean
  estimated: boolean
}

const BUFFER_MIN = 2
const describe = (legs: TransitLeg[]) => legs.map((l) => l.line).join(' + ')
const span = (legs: TransitLeg[]) => `${legs[0].from.name} → ${legs[legs.length - 1].to.name}`

type Channel = 'app' | 'paper' | 'sms'
const CHANNEL_LABEL: Record<Channel, string> = { app: 'v aplikaci PID Lítačka', paper: 'papírová (automat, předprodej)', sms: 'SMS jízdenka' }

function pidPart(legs: TransitLeg[], settings: Settings, channel: Channel): FarePart | null {
  const zones = [...new Set(legs.flatMap((l) => l.zones))]
  const duration = Math.ceil((legs[legs.length - 1].to.time - legs[0].from.time) / 60000) + BUFFER_MIN
  const d: TicketDecision = chooseTicket(zones, duration, settings.category, settings.coupons)
  const covers = `${describe(legs)} · ${span(legs)}`
  if (!d.needed) return { title: 'Bez jízdenky PID', covers, price: 0, note: d.reason, buy: [] }
  const price = d.product.prices[channel]
  if (price === undefined) return null // např. SMS mimo Prahu / pro zlevněné jízdné
  const lit = litackaLink()
  return {
    title: `PID ${d.product.name} – ${CHANNEL_LABEL[channel]}`,
    covers: `${covers} · pásma ${d.product.zones.join(', ')}`,
    price,
    note: d.note,
    buy:
      channel === 'app'
        ? [{ label: 'Otevřít PID Lítačku', href: lit.href, hint: `${lit.hint} V aplikaci vyber: ${d.product.name}.`, primary: true }]
        : [{ label: channel === 'sms' ? 'Jak koupit SMS jízdenku' : 'Kde koupit', href: 'https://pid.cz/jizdenky/' }],
  }
}

function cdPart(legs: TransitLeg[], settings: Settings): FarePart {
  const km = legs.reduce((s, l) => s + legKm(l), 0)
  const discount = CD_DISCOUNT[settings.category] > 0
  return {
    title: `Jízdenka ČD${discount ? ' se státní slevou 50 %' : ''}`,
    covers: `vlak ${describe(legs)} · ${span(legs)} · ~${Math.round(km)} km`,
    price: cdFareEstimate(km, settings.category),
    estimated: true,
    buy: [
      {
        label: 'Vyhledat v IDOS',
        href: idosLink(legs[0].from.name, legs[legs.length - 1].to.name, legs[0].from.time),
        hint: `Předvyplněno: ${span(legs)}, odjezd ${new Date(legs[0].from.time).toTimeString().slice(0, 5)}.`,
        primary: true,
      },
      {
        label: 'E-shop ČD',
        href: CD_ESHOP,
        copy: `${legs[0].from.name} → ${legs[legs.length - 1].to.name}`,
        hint: 'Stanice se zkopírují do schránky – v e-shopu je jen vlož.',
      },
    ],
    note: 'Platí jen ve vlacích ČD. Cena je orientační odhad, přesnou ukáže e-shop ČD (včasná jízdenka může být levnější).',
  }
}

/** živé ceny dopravců (FlixBus, RegioJet) podle legKey – načítají se asynchronně */
export type Quotes = Map<string, CarrierQuote | null>

/**
 * Úsek mimo PID a ČD: jízdenka u dopravce. FlixBus a RegioJet mají živou cenu a e-shop
 * s předvyplněnou trasou; ostatní web dopravce a IDOS s trasou a časem.
 */
function otherPart(l: TransitLeg, quotes?: Quotes): FarePart {
  const c = carrierOf(l)
  const q = quotes?.get(legKey(l))
  const covers = `${l.line} · ${l.from.name} → ${l.to.name}`
  const idos: BuyAction = {
    label: 'Vyhledat v IDOS',
    href: idosLink(l.from.name, l.to.name, l.from.scheduled),
    hint: `IDOS s předvyplněnou trasou ${l.from.name} → ${l.to.name}, odjezd ${new Date(l.from.scheduled).toTimeString().slice(0, 5)}.`,
  }
  const buy: BuyAction[] = []
  if (q) buy.push({ label: `Koupit u ${c.name}`, href: q.href, hint: 'Otevře e-shop dopravce s předvyplněnou trasou a datem – vyber spoj a zaplať.', primary: true })
  else if (c.web) buy.push({ label: c.id === 'other' ? 'Web dopravce' : `E-shop ${c.name}`, href: c.web, copy: `${l.from.name} → ${l.to.name}`, primary: c.id !== 'other' })
  // bez přímého nákupu u dopravce aspoň IDOS s trasou (u FlixBusu bývají názvy stanic anglicky – IDOS je nenajde)
  if (!q) buy.push(idos)
  return {
    title: `Jízdenka ${c.name}`,
    covers,
    price: q ? q.price : null,
    priceFrom: q?.from,
    buy,
    note: q?.note ?? (quotes?.has(legKey(l)) || c.id === 'other' ? 'Cenu ukáže dopravce – v jeho e-shopu, aplikaci nebo u řidiče.' : undefined),
  }
}

/** Rozdělí úseky na souvislé skupiny podle klíče (pěší úseky se přeskakují). */
function groups(legs: Leg[], keyOf: (l: TransitLeg) => string | null) {
  const out: { key: string; legs: TransitLeg[] }[] = []
  for (const l of legs) {
    if (l.kind !== 'transit') continue
    const key = keyOf(l)
    if (key === null) continue
    const last = out[out.length - 1]
    if (last && last.key === key) last.legs.push(l)
    else out.push({ key, legs: [l] })
  }
  return out
}

const make = (id: string, label: string, parts: (FarePart | null)[]): FareOption | null => {
  if (parts.some((p) => p === null)) return null
  const ps = parts as FarePart[]
  return {
    id,
    label,
    parts: ps,
    total: ps.reduce((s, p) => s + (p.price ?? 0), 0),
    incomplete: ps.some((p) => p.price === null),
    estimated: ps.some((p) => p.estimated),
  }
}

export function fareOptions(j: Journey, settings: Settings, quotes?: Quotes): FareOption[] {
  const legs = j.legs.filter((l): l is TransitLeg => l.kind === 'transit')
  const pidLegs = legs.filter((l) => l.isPid)
  const foreign = legs.filter((l) => !l.isPid)
  const foreignParts = (cdOk: boolean) => {
    // úseky mimo PID: ČD nacenit odhadem, ostatní jen odkázat
    const cd = groups(foreign, (l) => (cdOk && l.operator === 'cd' ? 'cd' : null))
    return [...cd.map((g) => cdPart(g.legs, settings)), ...foreign.filter((l) => !(cdOk && l.operator === 'cd')).map((l) => otherPart(l, quotes))]
  }

  const options: (FareOption | null)[] = []

  // A) celé PID jedním lístkem (+ případné úseky mimo PID)
  if (pidLegs.length) {
    for (const ch of ['app', 'paper', 'sms'] as Channel[]) {
      options.push(make(`pid-${ch}`, `PID ${CHANNEL_LABEL[ch]}`, [pidPart(pidLegs, settings, ch), ...foreignParts(true)]))
    }
  } else if (foreign.length) {
    options.push(make('foreign', 'Jízdenky dopravců', foreignParts(true)))
  }

  // B) vlaky na jízdenku ČD, MHD na PID (každý souvislý úsek MHD zvlášť)
  const trainOk = (l: TransitLeg) => l.vehicle === 'train' && (l.operator === 'cd' || (l.isPid && /^[SR]\d+/.test(l.line)))
  if (legs.some(trainOk) && pidLegs.some((l) => trainOk(l))) {
    const parts: (FarePart | null)[] = []
    for (const g of groups(legs, (l) => (trainOk(l) ? 'cd' : l.isPid ? 'pid' : 'other'))) {
      if (g.key === 'cd') parts.push(cdPart(g.legs, settings))
      else if (g.key === 'pid') parts.push(pidPart(g.legs, settings, 'app'))
      else parts.push(...g.legs.map((l) => otherPart(l, quotes)))
    }
    options.push(make('cd-mix', 'Vlak s jízdenkou ČD + MHD s PID', parts))
  }

  // sdílené kolo na začátku cesty se platí zvlášť – přidej ho ke každé variantě
  // sdílená kola na začátku / konci cesty
  const bikeParts: FarePart[] = []
  j.legs.forEach((l, i) => {
    if (l.kind !== 'walk' || !l.bike) return
    const b = l.bike
    const late = i > 0 && l.bikeLater
    bikeParts.push({
      title: `Sdílené kolo ${b.brand} ${b.area}${i > 0 ? ' (do cíle)' : ''}`,
      covers: `${b.from.name} → ${b.to.name} · ~${b.rideMin} min`,
      price: b.price,
      note: [b.freeNote, late ? 'Kolo si půjčíš až po příjezdu – počet kol je z teď, může se změnit.' : ''].filter(Boolean).join(' ') || undefined,
      buy: [{ label: `Půjčit v aplikaci ${b.brand}`, href: b.open.href, hint: b.open.hint, primary: true }],
    })
  })
  const bikeTotal = bikeParts.reduce((s, p) => s + (p.price ?? 0), 0)
  const withBike = (o: FareOption): FareOption => {
    if (!bikeParts.length) return o
    const first = j.legs[0]?.kind === 'walk' && j.legs[0].bike ? [bikeParts[0]] : []
    const rest = bikeParts.slice(first.length)
    return {
      ...o,
      parts: [...first, ...o.parts, ...rest],
      total: o.total + bikeTotal,
      incomplete: o.incomplete || bikeParts.some((p) => p.price === null),
    }
  }

  // stejné varianty (např. SMS = aplikace) nezobrazuj dvakrát; nejlevnější první
  const seen = new Set<string>()
  return (options.filter(Boolean) as FareOption[])
    .map(withBike)
    .filter((o) => {
      const k = o.parts.map((p) => `${p.title}:${p.price}`).join('|')
      return seen.has(k) ? false : (seen.add(k), true)
    })
    .sort((a, b) => a.total - b.total || Number(a.estimated) - Number(b.estimated))
}
