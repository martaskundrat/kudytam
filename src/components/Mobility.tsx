import { useEffect, useState } from 'react'
import { formatDistance } from '../lib/geo'
import type { Journey } from '../lib/journeys'
import { bikeOptions, TAXI_PICKUP_MIN, taxiOption, type BikeOption } from '../lib/mobility'
import type { LatLon, Settings } from '../types'
import { fmtKc, fmtTime, IconBike, IconCar, IconSparkle } from './ui'

const bestTransitEnd = (journeys: Journey[], now: number) =>
  journeys.filter((j) => j.start >= now - 30000).reduce((m, j) => Math.min(m, j.end), Infinity)

function Compare({ arrival, journeys, now }: { arrival: number; journeys: Journey[]; now: number }) {
  const end = bestTransitEnd(journeys, now)
  if (end === Infinity) return null
  const diff = Math.round((end - arrival) / 60000)
  return (
    <span className="text-muted">
      {' '}
      · {diff > 0 ? `o ${diff} min dřív` : diff < 0 ? `o ${-diff} min později` : 'stejně'} než nejrychlejší MHD
    </span>
  )
}

const btn = (primary?: boolean) =>
  `rounded-full px-4 py-2 text-sm font-bold transition active:scale-95 ${primary ? 'bg-brand text-black hover:bg-brand-hover' : 'ring-1 ring-zinc-500 hover:ring-white'}`
const ext = (href: string) => (href.startsWith('intent:') ? {} : { target: '_blank', rel: 'noreferrer' })

/** Mapy.com: navigace na kole mezi stanicemi (souřadnice v pořadí lon,lat) */
const bikeNav = (a: LatLon, b: LatLon) =>
  'https://mapy.com/fnc/v1/route?' +
  new URLSearchParams({ mapset: 'outdoor', start: `${a.lon},${a.lat}`, end: `${b.lon},${b.lat}`, routeType: 'bike_road', navigate: 'true' })

/** Sdílené kolo (živá data GBFS) – načte se samo pro dané odkud/kam. */
export function BikeCards({
  from,
  to,
  walkKmh,
  settings,
  now,
  journeys,
}: {
  from: LatLon
  to: LatLon
  walkKmh: number
  settings: Settings
  now: number
  journeys: Journey[]
}) {
  const [opts, setOpts] = useState<BikeOption[] | null>(null)
  const radius = settings.wideRadius
  const rider = { category: settings.category, coupons: settings.coupons }
  const key = `${from.lat},${from.lon}|${to.lat},${to.lon}|${walkKmh}|${radius}|${rider.category}|${JSON.stringify(rider.coupons)}`
  // obnov s odjezdy (volná kola se mění), ale ne při každém tiku hodin
  const tick = Math.floor(now / 90000)
  useEffect(() => {
    let alive = true
    bikeOptions(from, to, walkKmh, radius, rider)
      .then((o) => alive && setOpts(o))
      .catch(() => alive && setOpts([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  if (!opts?.length) return null
  return (
    <>
      {opts.map((o) => {
        const arrival = now + o.totalMin * 60000
        const faster = arrival < bestTransitEnd(journeys, now)
        return (
          <div key={o.brand} className={`rounded-2xl p-4 ${faster ? 'bg-gradient-to-br from-brand/25 to-surface ring-1 ring-brand' : 'bg-surface'}`}>
            {faster && (
              <div className="mb-2 flex items-center gap-1 text-[11px] font-bold tracking-wider text-brand uppercase">
                <IconSparkle className="size-3.5" /> Na kole jsi tam dřív než MHD
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2 text-xl font-extrabold">
                <IconBike className="size-6" /> Sdílené kolo · {o.brand}
              </div>
              <div className="shrink-0 font-bold text-muted">~{o.totalMin} min</div>
            </div>
            <p className="mt-1 text-sm">
              V cíli kolem <b>{fmtTime(arrival)}</b>
              <Compare arrival={arrival} journeys={journeys} now={now} />
            </p>
            <ol className="mt-2 space-y-0.5 text-sm text-muted">
              <li>
                Pěšky {o.from.walkMin} min na stanici <span className="text-white">{o.from.name}</span>{' '}
                <span className="text-brand">
                  ({o.from.bikes} {o.from.bikes === 1 ? 'kolo' : o.from.bikes < 5 ? 'kola' : 'kol'})
                </span>
              </li>
              <li>
                Na kole ~{o.rideMin} min · {formatDistance(o.rideM)} na <span className="text-white">{o.to.name}</span>
                {!o.to.virtual && <span className="text-subtle"> ({o.to.docks} volných stojanů)</span>}
              </li>
              {o.to.walkMin >= 1 && <li>Pěšky {o.to.walkMin} min do cíle</li>}
            </ol>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="text-xs text-subtle">
                {o.price === 0 ? 'Jízda zdarma' : o.priceLabel ? `Ceník ${o.brand}: ${o.priceLabel}` : 'Cenu ukáže aplikace'}
              </span>
              {o.price !== null && <span className="shrink-0 text-xl font-black text-brand">{fmtKc(o.price)}</span>}
            </div>
            {o.freeNote && <p className="mt-1 text-xs text-brand">{o.freeNote}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={o.open.href} {...ext(o.open.href)} className={btn(true)}>
                Půjčit v aplikaci {o.brand}
              </a>
              <a href={bikeNav(o.from, o.to)} target="_blank" rel="noreferrer" className={btn()}>
                Navigovat na kole
              </a>
            </div>
            <p className="mt-1 text-[11px] text-subtle">
              {o.open.hint} Volná kola podle živých dat {o.brand}, čas jízdy je odhad.
            </p>
          </div>
        )
      })}
    </>
  )
}

/** Taxi / odvoz přes aplikaci – čas jízdy autem z Transitous, orientační cena. */
export function TaxiCard({
  car,
  from,
  to,
  now,
  journeys,
}: {
  car: { durationMin: number; meters: number }
  from: LatLon & { name?: string }
  to: LatLon & { name: string }
  now: number
  journeys: Journey[]
}) {
  const t = taxiOption(car, from, to, now)
  if (!t) return null
  const copyDest = () => navigator.clipboard?.writeText(to.name).catch(() => {})
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-xl font-extrabold">
          <IconCar className="size-6" /> Taxi · Uber, Bolt, Liftago
        </div>
        <div className="shrink-0 font-bold text-muted">
          {t.durationMin} min · {formatDistance(t.meters)}
        </div>
      </div>
      <p className="mt-1 text-sm">
        V cíli kolem <b>{fmtTime(t.arrival)}</b>
        <Compare arrival={t.arrival} journeys={journeys} now={now} />
      </p>
      <p className="text-xs text-subtle">Počítáme s ~{TAXI_PICKUP_MIN} min, než auto přijede.</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-xs text-subtle">Orientační cena – přesnou ukáže aplikace před objednáním</span>
        <span className="shrink-0 text-xl font-black text-brand">
          ~{t.priceLow}–{fmtKc(t.priceHigh)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {t.services.map((s, i) => (
          <a key={s.id} href={s.link.href} {...ext(s.link.href)} onClick={s.prefilled ? undefined : copyDest} className={btn(i === 0)}>
            {s.name}
          </a>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-subtle">
        Uber se otevře s předvyplněným cílem. U Boltu a Liftaga se cíl „{to.name}“ zkopíruje do schránky – v aplikaci ho jen vlož.
      </p>
    </div>
  )
}
