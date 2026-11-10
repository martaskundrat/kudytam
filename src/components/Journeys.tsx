import { Fragment, useEffect, useRef, useState, type TouchEvent } from 'react'
import { formatDistance } from '../lib/geo'
import { firstWalk, transitLegs, type Journey } from '../lib/journeys'
import { settingsStore, useStore } from '../lib/store'
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
 * Detail spojení. Swipe doleva = dřívější spojení, swipe doprava = pozdější (jako v IDOSu).
 * Totéž tlačítky ‹ › nebo šipkami na klávesnici.
 */
export function JourneySheet({ journey, nav, onClose }: { journey: Journey | null; nav: JourneyNav; onClose: () => void }) {
  const settings = useStore(settingsStore)
  const now = useNow(5000)
  const [dx, setDx] = useState(0)
  const [enter, setEnter] = useState<'' | 'from-left' | 'from-right'>('')
  const touch = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null)
  const navRef = useRef(nav)
  navRef.current = nav

  const go = (dir: 'prev' | 'next') => {
    const n = navRef.current
    if ((dir === 'prev' && !n.canPrev) || (dir === 'next' && !n.canNext) || n.loading) return
    // prst jde doleva -> nový obsah přijede zprava, a naopak
    setEnter(dir === 'prev' ? 'from-right' : 'from-left')
    n.go(dir)
  }

  useEffect(() => {
    if (!journey) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go('prev')
      if (e.key === 'ArrowRight') go('next')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!journey])

  if (!journey) return null
  const q = quoteJourney(journey, settings)
  const departed = journey.start < now - 30000

  const onTouchStart = (e: TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null })
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current
    if (!t) return
    const mx = e.touches[0].clientX - t.x
    const my = e.touches[0].clientY - t.y
    if (t.horizontal === null && Math.abs(mx) + Math.abs(my) > 10) t.horizontal = Math.abs(mx) > Math.abs(my)
    if (t.horizontal) setDx(mx)
  }
  const onTouchEnd = () => {
    if (dx <= -SWIPE_PX) go('prev')
    else if (dx >= SWIPE_PX) go('next')
    setDx(0)
    touch.current = null
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          onClick={() => go('prev')}
          disabled={!nav.canPrev || nav.loading}
          className="rounded-full bg-highlight px-3 py-1.5 text-sm font-semibold text-muted hover:text-white disabled:opacity-30"
        >
          ‹ Dřívější
        </button>
        <span className="text-xs text-subtle">{nav.loading ? 'Načítám…' : (nav.position ?? '')}</span>
        <button
          onClick={() => go('next')}
          disabled={!nav.canNext || nav.loading}
          className="rounded-full bg-highlight px-3 py-1.5 text-sm font-semibold text-muted hover:text-white disabled:opacity-30"
        >
          Pozdější ›
        </button>
      </div>

      <div
        key={journey.id}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onAnimationEnd={() => setEnter('')}
        className={enter === 'from-right' ? 'animate-enter-right' : enter === 'from-left' ? 'animate-enter-left' : ''}
        style={{
          transform: dx ? `translateX(${dx * 0.6}px)` : undefined,
          opacity: dx ? Math.max(0.4, 1 - Math.abs(dx) / 400) : undefined,
          transition: dx ? 'none' : 'transform .2s, opacity .2s',
        }}
      >
      <div className="flex items-baseline justify-between pb-1">
        <div className="text-2xl font-black tabular-nums">
          {fmtTime(journey.start)} → {fmtTime(journey.end)}
        </div>
        <div className="font-bold text-muted">{journey.durationMin} min</div>
      </div>
      <p className={`mb-4 text-sm font-semibold ${departed ? 'text-red-400' : journey.start - now < 120000 ? 'text-brand' : 'text-muted'}`}>
        {departed ? 'Tohle spojení už odjelo' : leaveLabel(journey, now)} ·{' '}
        <span className="font-normal text-subtle">{journey.transfers === 0 ? 'bez přestupu' : journey.transfers === 1 ? '1 přestup' : `${journey.transfers} přestupy`}</span>
      </p>


      <ol className="space-y-1">
        {journey.legs.map((l, i) =>
          l.kind === 'walk' ? (
            l.durationMin < 1 ? null : (
              <li key={i} className="flex items-center gap-3 py-1.5 pl-2 text-sm text-muted">
                <IconWalk className="size-4" />
                Pěšky {l.durationMin} min{l.meters > 0 && ` · ${formatDistance(l.meters)}`}
                {i === 0 && l.to.name ? ` na ${l.to.name}` : i === journey.legs.length - 1 ? ' do cíle' : ' (přestup)'}
              </li>
            )
          ) : (
            <li key={i} className="rounded-2xl bg-surface p-3">
              <div className="flex items-center gap-3">
                <LineBadge dep={{ line: l.line, vehicle: l.vehicle, isNight: false }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{l.headsign}</div>
                  <div className="text-xs text-subtle">
                    {VEHICLE_LABEL[l.vehicle]} · {l.stops} {l.stops === 1 ? 'zastávka' : l.stops < 5 ? 'zastávky' : 'zastávek'} · {l.durationMin} min
                    {l.realTime && (l.delayMin ? <span className="text-amber-400"> · zpoždění {l.delayMin} min</span> : <span className="text-brand"> · včas</span>)}
                  </div>
                </div>
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
            </li>
          ),
        )}
      </ol>

      <div className="mt-4 space-y-2 pb-6">
        <TicketInfo q={q} category={settings.category} />
        {q.nonPid.length > 0 && (
          <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Úsek {q.nonPid.map((l) => `${l.line} (${l.from.name} → ${l.to.name})`).join(', ')} nevede po síti PID – jízdenku na něj kup u dopravce
            {q.nonPid[0].agency ? ` (${q.nonPid[0].agency})` : ''}.
          </p>
        )}
      </div>
      </div>
      <p className="pb-6 text-center text-[11px] text-subtle">Swipe doleva = dřívější spoj · doprava = pozdější</p>
    </Sheet>
  )
}
