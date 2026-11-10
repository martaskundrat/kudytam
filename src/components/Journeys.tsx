import { Fragment, useEffect, useRef, useState, type TouchEvent } from 'react'
import { formatDistance } from '../lib/geo'
import { firstWalk, shiftLeg, transitLegs, type Journey, type TransitLeg } from '../lib/journeys'
import { settingsStore, speedKmh, useStore } from '../lib/store'
import { quoteJourney } from '../lib/tickets'
import { TicketInfo } from './TicketInfo'
import { fmtKc, fmtTime, IconSparkle, IconWalk, LineBadge, Sheet, useNow, VEHICLE_LABEL } from './ui'

export interface JourneyPick {
  journey: Journey
  /** o kolik min dřív dorazíš než nejlepším spojem z nejbližších zastávek */
  savedMin: number | null
  farStop: boolean
}

/**
 * Doporučení: nejdřívější příjezd. Pokud vede přes vzdálenější zastávku,
 * spočítáme, kolik ušetří oproti nejlepšímu spoji z nejbližšího okolí.
 */
export function recommend(journeys: Journey[], nearRadius: number, now: number): JourneyPick | null {
  const live = journeys.filter((j) => j.start >= now - 30000 && !transitLegs(j).some((l) => l.cancelled))
  if (!live.length) return null
  const best = live.reduce((a, b) => (b.end < a.end || (b.end === a.end && b.transfers < a.transfers) ? b : a))
  const isNear = (j: Journey) => (firstWalk(j)?.meters ?? 0) <= nearRadius * 1.3
  const bestNear = live.filter(isNear).reduce<Journey | null>((a, b) => (!a || b.end < a.end ? b : a), null)
  const farStop = !isNear(best)
  return { journey: best, farStop, savedMin: farStop && bestNear ? Math.round((bestNear.end - best.end) / 60000) : null }
}

const leaveLabel = (j: Journey, now: number) => {
  const m = Math.floor((j.start - now) / 60000)
  return m <= 0 ? 'Vyraž hned' : m < 60 ? `Vyraž za ${m} min` : `Vyraž v ${fmtTime(j.start)}`
}

function LegChips({ j }: { j: Journey }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {j.legs.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-xs text-subtle">›</span>}
          {l.kind === 'walk' ? (
            l.durationMin >= 1 ? (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted">
                <IconWalk className="size-3.5" />
                {l.durationMin}
              </span>
            ) : null
          ) : (
            <LineBadge dep={{ line: l.line, vehicle: l.vehicle, isNight: false }} size="sm" />
          )}
        </Fragment>
      ))}
    </div>
  )
}

export function JourneyCard({ j, now, pick, onSelect }: { j: Journey; now: number; pick?: JourneyPick | null; onSelect: (j: Journey) => void }) {
  const settings = useStore(settingsStore)
  const q = quoteJourney(j, settings)
  const firstTransit = transitLegs(j)[0]
  const missed = j.start < now - 30000
  const recommended = pick?.journey.id === j.id
  const delay = firstTransit?.delayMin
  return (
    <button
      onClick={() => onSelect(j)}
      className={`w-full rounded-2xl p-4 text-left transition active:scale-[0.99] ${
        recommended ? 'bg-gradient-to-br from-brand/25 to-surface ring-1 ring-brand' : 'bg-surface hover:bg-highlight'
      } ${missed ? 'opacity-40' : ''}`}
    >
      {recommended && (
        <div className="mb-2 flex items-center gap-1 text-[11px] font-bold tracking-wider text-brand uppercase">
          <IconSparkle className="size-3.5" />
          {pick.farStop ? 'Nejrychlejší – přes vzdálenější zastávku' : 'Nejrychlejší'}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xl font-extrabold tabular-nums">
          {fmtTime(j.start)} <span className="text-subtle">→</span> {fmtTime(j.end)}
        </div>
        <div className="font-bold text-muted">{j.durationMin} min</div>
      </div>
      <div className="mt-2">
        <LegChips j={j} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span className={`font-semibold ${j.start - now < 120000 ? 'text-brand' : ''}`}>{leaveLabel(j, now)}</span>
        {firstTransit && (
          <span className="text-muted">
            · {firstTransit.line} z {firstTransit.from.name} {fmtTime(firstTransit.from.time)}
            {delay ? <span className="text-amber-400"> +{delay}</span> : null}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-subtle">
        <span>{j.transfers === 0 ? 'bez přestupu' : j.transfers === 1 ? '1 přestup' : `${j.transfers} přestupy`}</span>
        <span>{q.decision.needed ? `${q.decision.product.name.split(' · ').slice(0, 2).join(' · ')} · ${fmtKc(q.decision.product.prices.app)}` : 'jízdenka není potřeba'}</span>
      </div>
      {recommended && pick.savedMin !== null && pick.savedMin > 0 && (
        <p className="mt-2 text-sm text-brand">
          Dojdi {firstWalk(j)?.durationMin} min na {firstTransit?.from.name} a dorazíš o <b>{pick.savedMin} min</b> dřív než z nejbližší zastávky.
        </p>
      )}
    </button>
  )
}

export interface JourneyNav {
  /** je k dispozici dřívější / pozdější spojení (načtené nebo k donačtení) */
  canPrev: boolean
  canNext: boolean
  loading: boolean
  go: (dir: 'prev' | 'next') => void
  position?: string
}

const SWIPE_PX = 60

/**
 * Detail spojení.
 * - Karta úseku: tah doleva = pozdější spoj na tomto úseku, doprava = dřívější (jako v IDOSu).
 *   Předchozí úseky zůstanou, zbytek cesty se přepočítá.
 * - Tlačítka nahoře / šipky na klávesnici: celé dřívější / pozdější spojení.
 */
export function JourneySheet({ journey, nav, onClose }: { journey: Journey | null; nav: JourneyNav; onClose: () => void }) {
  const settings = useStore(settingsStore)
  const now = useNow(5000)
  // upravené spojení (po výměně spoje na úseku) – platí jen pro spojení, ze kterého vzniklo
  const [override, setOverride] = useState<{ baseId: string; j: Journey } | null>(null)
  const [busyLeg, setBusyLeg] = useState<number | null>(null)
  const [note, setNote] = useState<{ leg: number; text: string } | null>(null)
  const [entered, setEntered] = useState<{ leg: number; from: 'left' | 'right' } | null>(null)
  const navRef = useRef(nav)
  navRef.current = nav

  const goJourney = (dir: 'prev' | 'next') => {
    const n = navRef.current
    if ((dir === 'prev' && !n.canPrev) || (dir === 'next' && !n.canNext) || n.loading) return
    setNote(null)
    n.go(dir)
  }

  useEffect(() => {
    if (!journey) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goJourney('prev')
      if (e.key === 'ArrowRight') goJourney('next')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!journey])

  if (!journey) return null
  const shown = override?.baseId === journey.id ? override.j : journey
  const q = quoteJourney(shown, settings)
  const departed = shown.start < now - 30000
  const dest = settings.destination

  const shift = async (legIndex: number, dir: 'prev' | 'next') => {
    if (!dest || busyLeg !== null) return
    setBusyLeg(legIndex)
    setNote(null)
    try {
      const j = await shiftLeg(shown, legIndex, dir, dest, speedKmh(settings))
      if (j) {
        setOverride({ baseId: journey.id, j })
        setEntered({ leg: legIndex, from: dir === 'next' ? 'right' : 'left' })
      } else {
        setNote({
          leg: legIndex,
          text: dir === 'prev' ? 'Dřívější spoj už nestihneš.' : 'Pozdější spoj odtud v příští hodině nejede.',
        })
      }
    } catch (e) {
      setNote({ leg: legIndex, text: (e as Error).message })
    } finally {
      setBusyLeg(null)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          onClick={() => goJourney('prev')}
          disabled={!nav.canPrev || nav.loading}
          className="rounded-full bg-highlight px-3 py-1.5 text-sm font-semibold text-muted hover:text-white disabled:opacity-30"
        >
          ‹ Dřívější
        </button>
        <span className="text-xs text-subtle">{nav.loading ? 'Načítám…' : 'celé spojení'}</span>
        <button
          onClick={() => goJourney('next')}
          disabled={!nav.canNext || nav.loading}
          className="rounded-full bg-highlight px-3 py-1.5 text-sm font-semibold text-muted hover:text-white disabled:opacity-30"
        >
          Pozdější ›
        </button>
      </div>

      <div className="flex items-baseline justify-between pb-1">
        <div className="text-2xl font-black tabular-nums">
          {fmtTime(shown.start)} → {fmtTime(shown.end)}
        </div>
        <div className="font-bold text-muted">{shown.durationMin} min</div>
      </div>
      <p className={`text-sm font-semibold ${departed ? 'text-red-400' : shown.start - now < 120000 ? 'text-brand' : 'text-muted'}`}>
        {departed ? 'Tohle spojení už odjelo' : leaveLabel(shown, now)} ·{' '}
        <span className="font-normal text-subtle">
          {shown.transfers === 0 ? 'bez přestupu' : shown.transfers === 1 ? '1 přestup' : `${shown.transfers} přestupy`}
        </span>
      </p>
      {override?.baseId === journey.id ? (
        <button onClick={() => setOverride(null)} className="mb-3 text-xs font-semibold text-brand">
          Upraveno · vrátit původní spojení
        </button>
      ) : (
        <div className="mb-3" />
      )}

      <ol className="space-y-1">
        {shown.legs.map((l, i) =>
          l.kind === 'walk' ? (
            l.durationMin < 1 ? null : (
              <li key={`w${i}`} className="flex items-center gap-3 py-1.5 pl-2 text-sm text-muted">
                <IconWalk className="size-4" />
                Pěšky {l.durationMin} min{l.meters > 0 && ` · ${formatDistance(l.meters)}`}
                {i === 0 && l.to.name ? ` na ${l.to.name}` : i === shown.legs.length - 1 ? ' do cíle' : ' (přestup)'}
              </li>
            )
          ) : (
            <LegCard
              key={`${l.line}@${l.from.scheduled}`}
              leg={l}
              busy={busyLeg === i}
              note={note?.leg === i ? note.text : null}
              enterFrom={entered?.leg === i ? entered.from : null}
              canShift={!!dest && !!l.from.stopId}
              onShift={(dir) => shift(i, dir)}
            />
          ),
        )}
      </ol>

      <div className="mt-4 space-y-2">
        <TicketInfo q={q} category={settings.category} />
        {q.nonPid.length > 0 && (
          <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Úsek {q.nonPid.map((l) => `${l.line} (${l.from.name} → ${l.to.name})`).join(', ')} nevede po síti PID – jízdenku na něj kup u
            dopravce{q.nonPid[0].agency ? ` (${q.nonPid[0].agency})` : ''}.
          </p>
        )}
      </div>
      <p className="py-5 text-center text-[11px] text-subtle">Kartu spoje táhni doleva = pozdější spoj · doprava = dřívější</p>
    </Sheet>
  )
}

/** Karta jednoho úseku; tahem do stran se vymění spoj na tomto úseku. */
function LegCard({
  leg: l,
  busy,
  note,
  enterFrom,
  canShift,
  onShift,
}: {
  leg: TransitLeg
  busy: boolean
  note: string | null
  enterFrom: 'left' | 'right' | null
  canShift: boolean
  onShift: (dir: 'prev' | 'next') => void
}) {
  const [dx, setDx] = useState(0)
  const touch = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null)

  const onTouchStart = (e: TouchEvent) => {
    if (canShift) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null }
  }
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current
    if (!t) return
    const mx = e.touches[0].clientX - t.x
    const my = e.touches[0].clientY - t.y
    if (t.horizontal === null && Math.abs(mx) + Math.abs(my) > 10) t.horizontal = Math.abs(mx) > Math.abs(my)
    if (t.horizontal) setDx(mx)
  }
  const onTouchEnd = () => {
    // prst doleva = pozdější spoj, doprava = dřívější
    if (dx <= -SWIPE_PX) onShift('next')
    else if (dx >= SWIPE_PX) onShift('prev')
    setDx(0)
    touch.current = null
  }

  const anim = enterFrom === 'right' ? 'animate-enter-right' : enterFrom === 'left' ? 'animate-enter-left' : ''
  return (
    <li className="relative overflow-hidden rounded-2xl bg-highlight">
      {/* co se stane po puštění – vidět pod kartou při tažení */}
      {dx !== 0 && (
        <div className={`absolute inset-0 flex items-center px-4 text-sm font-bold text-brand ${dx < 0 ? 'justify-end' : 'justify-start'}`}>
          {dx < 0 ? 'Pozdější spoj ›' : '‹ Dřívější spoj'}
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`relative bg-surface p-3 ${anim} ${busy ? 'opacity-60' : ''}`}
        style={{ transform: dx ? `translateX(${dx * 0.7}px)` : undefined, transition: dx ? 'none' : 'transform .2s' }}
      >
        <div className="flex items-center gap-3">
          <LineBadge dep={{ line: l.line, vehicle: l.vehicle, isNight: false }} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{l.headsign}</div>
            <div className="text-xs text-subtle">
              {VEHICLE_LABEL[l.vehicle]} · {l.stops} {l.stops === 1 ? 'zastávka' : l.stops < 5 ? 'zastávky' : 'zastávek'} · {l.durationMin} min
              {l.realTime && (l.delayMin ? <span className="text-amber-400"> · zpoždění {l.delayMin} min</span> : <span className="text-brand"> · včas</span>)}
            </div>
          </div>
          {canShift && (
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => onShift('prev')}
                disabled={busy}
                className="rounded-full bg-highlight px-2.5 py-1 text-muted hover:text-white"
                aria-label="Dřívější spoj na tomto úseku"
              >
                ‹
              </button>
              <button
                onClick={() => onShift('next')}
                disabled={busy}
                className="rounded-full bg-highlight px-2.5 py-1 text-muted hover:text-white"
                aria-label="Pozdější spoj na tomto úseku"
              >
                ›
              </button>
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1.5 text-sm">
          <span className="font-bold tabular-nums">{fmtTime(l.from.time)}</span>
          <span>
            {l.from.name}
            {l.from.track && <span className="text-subtle"> · nást. {l.from.track}</span>}
          </span>
          <span className="font-bold tabular-nums text-muted">{fmtTime(l.to.time)}</span>
          <span className="text-muted">
            {l.to.name}
            {l.to.track && <span className="text-subtle"> · nást. {l.to.track}</span>}
          </span>
        </div>
        {l.cancelled && <p className="mt-2 text-sm font-semibold text-red-400">Spoj je zrušen.</p>}
        {busy && <p className="mt-2 text-xs text-muted">Hledám jiný spoj…</p>}
        {note && <p className="mt-2 text-xs text-amber-300">{note}</p>}
      </div>
    </li>
  )
}
