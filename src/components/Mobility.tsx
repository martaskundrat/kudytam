import { useEffect, useState } from 'react'
import { formatDistance } from '../lib/geo'
import { leaveAt, type Journey, type When } from '../lib/journeys'
import { fmtWhen } from '../lib/time'
import { bikeOptions, TAXI_PICKUP_MIN, taxiOption, type BikeOption } from '../lib/mobility'
import type { LatLon, Settings } from '../types'
import { NavButtons } from './NavButtons'
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


/** Sdílené kolo (živá data GBFS) – načte se samo pro dané odkud/kam. */
export function BikeCards({
  from,
  to,
  walkKmh,
  settings,
  now,
  journeys,
  when,
}: {
  from: LatLon
  to: LatLon & { tz?: string }
  walkKmh: number
  settings: Settings
  now: number
  journeys: Journey[]
  when?: When | null
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
        const leave = leaveAt(when, now, o.totalMin)
        const arrival = leave + o.totalMin * 60000
        const later = leave - now > 20 * 60000
        const faster = arrival < bestTransitEnd(journeys, now)
        return (
          <div key={o.systemId} className={`rounded-2xl p-4 ${faster ? 'bg-gradient-to-br from-brand/25 to-surface ring-1 ring-brand' : 'bg-surface'}`}>
            {faster && (
              <div className="mb-2 flex items-center gap-1 text-[11px] font-bold tracking-wider text-brand uppercase">
                <IconSparkle className="size-3.5" /> Na kole jsi tam dřív než MHD
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2 text-xl font-extrabold">
                <IconBike className="size-6" /> Sdílené kolo · {o.brand} {o.area}
              </div>
              <div className="shrink-0 font-bold text-muted">~{o.totalMin} min</div>
            </div>
            <p className="mt-1 text-sm">
              {later && <>Vyraž v <b>{fmtWhen(leave, to.tz)}</b>, </>}V cíli kolem <b>{fmtTime(arrival, to.tz)}</b>
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
                <span className="text-subtle"> ({o.to.dockless ? 'parkovací místo, vrátíš kdykoli' : `${o.to.docks} volných stojanů`})</span>
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
              <NavButtons from={o.from} to={o.to} mode="bike" label="Navigovat na kole" />
            </div>
            <p className="mt-1 text-[11px] text-subtle">
              {o.open.hint} Volná kola podle živých dat {o.brand}
              {later ? ' – ověřená teď, do odjezdu se počet může změnit' : ''}, čas jízdy je odhad.
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
  when,
}: {
  car: { durationMin: number; meters: number }
  when?: When | null
  from: LatLon & { name?: string }
  to: LatLon & { name: string; tz?: string }
  now: number
  journeys: Journey[]
}) {
  const t = taxiOption(car, from, to, leaveAt(when, now, car.durationMin + TAXI_PICKUP_MIN))
  if (!t) return null
  const copyDest = () => navigator.clipboard?.writeText(to.name).catch(() => {})
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-xl font-extrabold">
          <IconCar className="size-6" /> Taxi · {t.services.map((s) => s.name).join(', ')}
        </div>
        <div className="shrink-0 font-bold text-muted">
          {t.durationMin} min · {formatDistance(t.meters)}
        </div>
      </div>
      <p className="mt-1 text-sm">
        V cíli kolem <b>{fmtTime(t.arrival, to.tz)}</b>
        <Compare arrival={t.arrival} journeys={journeys} now={now} />
      </p>
      <p className="text-xs text-subtle">
        {t.arrival - (TAXI_PICKUP_MIN + t.durationMin) * 60000 - now > 60000
          ? `Objednej na ${fmtWhen(t.arrival - (TAXI_PICKUP_MIN + t.durationMin) * 60000, to.tz)} (v aplikaci jde jízda naplánovat předem).`
          : `Počítáme s ~${TAXI_PICKUP_MIN} min, než auto přijede.`}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-xs text-subtle">
          {t.priceHigh === null ? 'Cenu ukáže aplikace před objednáním (v zahraničí ji neodhadujeme).' : 'Orientační cena – přesnou ukáže aplikace před objednáním'}
        </span>
        {t.priceHigh !== null && (
          <span className="shrink-0 text-xl font-black text-brand">
            ~{t.priceLow}–{fmtKc(t.priceHigh)}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {t.services.map((s, i) => (
          <a key={s.id} href={s.link.href} {...ext(s.link.href)} onClick={s.prefilled ? undefined : copyDest} className={btn(i === 0)}>
            {s.name}
          </a>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-subtle">
        Uber se otevře s předvyplněným cílem. U {t.services.length > 2 ? 'Boltu a Liftaga' : 'Boltu'} se cíl „{to.name}“ zkopíruje do
        schránky – v aplikaci ho jen vlož.
      </p>
    </div>
  )
}
