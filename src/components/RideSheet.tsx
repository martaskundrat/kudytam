import { formatDistance } from '../lib/geo'
import { settingsStore, useStore } from '../lib/store'
import { quote } from '../lib/tickets'
import type { LatLon, Option, Place } from '../types'
import { NavButtons } from './NavButtons'
import { leaveIn } from './Departures'
import { TicketInfo } from './TicketInfo'
import { fmtTime, IconWalk, LineBadge, minutesLabel, Sheet, useNow, VEHICLE_LABEL } from './ui'

export function RideSheet({
  option,
  destination,
  origin,
  onClose,
}: {
  option: Option | null
  destination: Place | null
  /** odkud se hledalo (poloha / výchozí místo) – pro navigaci na zastávku */
  origin?: LatLon | null
  onClose: () => void
}) {
  const settings = useStore(settingsStore)
  const now = useNow(5000)
  if (!option) return null
  const d = option.departure
  const l = leaveIn(option, now)

  return (
    <Sheet open onClose={onClose}>
      <div className="flex items-center gap-4 pb-4">
        <LineBadge dep={d} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-muted uppercase">{VEHICLE_LABEL[d.vehicle]}</div>
          <div className="truncate text-xl font-extrabold">{d.headsign}</div>
        </div>
        <div className="text-right text-2xl font-black tabular-nums">{minutesLabel(d.predicted, now)}</div>
      </div>

      <ol className="relative ml-3 space-y-4 border-l-2 border-dashed border-zinc-600 pb-1 pl-5">
        <li>
          <span className="absolute -left-[9px] mt-1 size-4 rounded-full bg-zinc-500" />
          <div className="flex items-center gap-1.5 font-semibold">
            <IconWalk className="size-4" /> {Math.max(1, Math.round(option.walkMin))} min · {formatDistance(option.walkMeters)}
          </div>
          <div className={`text-sm ${l < 0 ? 'text-red-400' : l < 1 ? 'text-brand' : 'text-muted'}`}>
            {l < 0 ? 'Tenhle spoj už asi nestihneš.' : l < 1 ? 'Vyraž hned!' : `Vyraž v ${fmtTime(now + l * 60000)} (za ${Math.floor(l)} min)`}
          </div>
          {origin && option.walkMeters >= 100 && (
            <div className="mt-2 flex flex-wrap gap-2">
              <NavButtons from={origin} to={d.stop} mode="foot" small label="Navigovat na zastávku" />
            </div>
          )}
        </li>
        <li>
          <span className="absolute -left-[9px] mt-1 size-4 rounded-full bg-brand" />
          <div className="font-semibold">
            {d.stop.name} {d.stop.platform && <span className="text-muted">· nástupiště {d.stop.platform}</span>}
          </div>
          <div className="text-sm text-muted">
            odjezd {fmtTime(d.predicted)}
            {d.delayMin ? <span className="text-amber-400"> (zpoždění {d.delayMin} min)</span> : null}
          </div>
        </li>
        {option.target && (
          <li>
            <span className="absolute -left-[9px] mt-1 size-4 rounded-full border-2 border-brand bg-elevated" />
            <div className="font-semibold">{option.target.stopName}</div>
            <div className="text-sm text-muted">
              příjezd {fmtTime(option.target.arrival)} · {Math.round((option.target.arrival - d.predicted) / 60000)} min jízdy
            </div>
          </li>
        )}
      </ol>

      <div className="mt-5 pb-6">
        <TicketInfo q={quote(option, settings, destination)} category={settings.category} />
      </div>
    </Sheet>
  )
}
