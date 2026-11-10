import { useState } from 'react'
import { formatDistance } from '../lib/geo'
import type { Recommendation, StopGroup } from '../lib/planner'
import type { Option } from '../types'
import { fmtTime, IconAccessible, IconSnow, IconSparkle, IconWalk, LineBadge, minutesLabel } from './ui'

/** Přepočte „vyraž za“ podle aktuálního času (data se načítají jen občas). */
export function leaveIn(o: Option, now: number) {
  return (o.departure.predicted - now) / 60000 - o.walkMin - 0.5
}

function LeaveHint({ o, now }: { o: Option; now: number }) {
  const l = leaveIn(o, now)
  if (l < 0) return <span className="text-subtle">nestihneš</span>
  if (l < 1) return <span className="font-semibold text-brand">vyraž hned</span>
  return <span className="text-muted">vyraž za {Math.floor(l)} min</span>
}

export function DepartureRow({ o, now, onSelect }: { o: Option; now: number; onSelect: (o: Option) => void }) {
  const d = o.departure
  const missed = leaveIn(o, now) < 0
  const mins = Math.floor((d.predicted - now) / 60000)
  return (
    <button
      onClick={() => onSelect(o)}
      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-highlight active:scale-[0.99] ${missed ? 'opacity-45' : ''}`}
    >
      <LineBadge dep={d} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{d.headsign}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          {d.stop.platform && <span className="rounded bg-highlight px-1.5 py-0.5">{d.stop.platform}</span>}
          <LeaveHint o={o} now={now} />
          {o.target && <span className="text-brand">· v cíli {fmtTime(o.target.arrival)}</span>}
          {d.wheelchair && <IconAccessible className="size-3.5" />}
          {d.airConditioned && <IconSnow className="size-3.5" />}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-lg font-bold tabular-nums ${mins <= 2 ? 'text-brand' : ''}`}>{minutesLabel(d.predicted, now)}</div>
        <div className="text-xs tabular-nums text-subtle">
          {fmtTime(d.predicted)}
          {d.delayMin ? <span className="ml-1 text-amber-400">+{d.delayMin}</span> : null}
        </div>
      </div>
    </button>
  )
}

export function StopCard({ g, now, onSelect, toDestination }: { g: StopGroup; now: number; onSelect: (o: Option) => void; toDestination?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const visible = g.options.filter((o) => o.departure.predicted > now - 30000)
  const shown = expanded ? visible : visible.slice(0, 5)
  return (
    <section className="rounded-2xl bg-surface p-3">
      <header className="mb-1 flex items-center justify-between px-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold">{g.name}</h3>
          <div className="flex items-center gap-1 text-sm text-muted">
            <IconWalk className="size-4" />
            {Math.max(1, Math.round(g.walkMin))} min · {formatDistance(g.distance)}
            {g.zones.length > 0 && <span className="ml-1 text-subtle">· pásmo {g.zones.join(', ')}</span>}
          </div>
        </div>
      </header>
      {shown.length === 0 ? (
        <p className="px-2 py-3 text-sm text-subtle">{toDestination ? 'V příští hodině odsud nic nejede do cíle.' : 'V příští hodině odsud nic nejede.'}</p>
      ) : (
        shown.map((o) => <DepartureRow key={o.departure.id} o={o} now={now} onSelect={onSelect} />)
      )}
      {visible.length > 5 && (
        <button onClick={() => setExpanded(!expanded)} className="w-full py-2 text-sm font-semibold text-muted hover:text-white">
          {expanded ? 'Méně' : `Další odjezdy (${visible.length - 5})`}
        </button>
      )}
    </section>
  )
}

export function RecommendationCard({ rec, now, onSelect }: { rec: Recommendation; now: number; onSelect: (o: Option) => void }) {
  const o = rec.option
  const d = o.departure
  const l = leaveIn(o, now)
  return (
    <button
      onClick={() => onSelect(o)}
      className="animate-fade-in relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-emerald-700 p-4 text-left text-black shadow-lg shadow-brand/20 transition active:scale-[0.99]"
    >
      <div className="mb-3 flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
        <IconSparkle className="size-4" /> Lepší spoj v okolí
      </div>
      <div className="flex items-center gap-3">
        <LineBadge dep={d} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg leading-tight font-extrabold">{d.headsign}</div>
          <div className="text-sm font-medium opacity-80">
            z {d.stop.name}
            {d.stop.platform ? ` (${d.stop.platform})` : ''} · {fmtTime(d.predicted)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black tabular-nums">{minutesLabel(d.predicted, now)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/15 px-3 py-1">
          <IconWalk className="size-4" /> {Math.max(1, Math.round(o.walkMin))} min chůze · {formatDistance(o.walkMeters)}
        </span>
        <span className="rounded-full bg-black/15 px-3 py-1">{l < 1 ? 'Vyraž hned!' : `Vyraž za ${Math.floor(l)} min`}</span>
        {o.target && <span className="rounded-full bg-black/15 px-3 py-1">v cíli {fmtTime(o.target.arrival)}</span>}
      </div>
      {rec.savedMin !== null && rec.savedMin > 0 && (
        <p className="mt-3 text-sm font-medium">
          {rec.basis === 'arrival' ? 'Dorazíš' : 'Odjedeš'} o <b>{rec.savedMin} min</b> dřív než z nejbližší zastávky.
        </p>
      )}
    </button>
  )
}
