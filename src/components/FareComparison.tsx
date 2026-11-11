import { useState } from 'react'
import { type FareOption, type FarePart } from '../lib/fares'
import { CATEGORY_LABELS } from '../lib/tickets'
import type { PassengerCategory } from '../types'
import { fmtKc, IconCheck, IconTicket } from './ui'

const totalLabel = (o: FareOption) => (o.total === 0 && !o.incomplete ? 'zdarma' : `${o.estimated ? '~' : ''}${fmtKc(o.total)}${o.incomplete ? ' +' : ''}`)

function Part({ p }: { p: FarePart }) {
  return (
    <li className="rounded-xl bg-highlight p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{p.title}</span>
        <span className="shrink-0 font-bold">
          {p.price === null ? <span className="font-normal text-subtle">cena u dopravce</span> : p.price === 0 ? 'zdarma' : `${p.estimated ? '~' : ''}${fmtKc(p.price)}`}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-subtle">{p.covers}</p>
      {p.note && <p className={`mt-1 text-xs ${p.price === 0 ? 'text-brand' : 'text-amber-300'}`}>{p.note}</p>}
      {p.buy && (
        <>
          <a
            href={p.buy.href}
            target={p.buy.href.startsWith('intent:') ? undefined : '_blank'}
            rel="noreferrer"
            className="mt-2 inline-block rounded-full bg-brand px-4 py-2 text-sm font-bold text-black transition hover:bg-brand-hover active:scale-95"
          >
            {p.buy.label}
          </a>
          {p.buy.hint && <p className="mt-1 text-[11px] text-subtle">{p.buy.hint}</p>}
        </>
      )}
    </li>
  )
}

/** Nejlevnější varianta jízdného nahoře, ostatní ve sbaleném menu. */
export function FareComparison({ options, category }: { options: FareOption[]; category: PassengerCategory }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!options.length) return null
  const [best, ...rest] = options
  const free = best.total === 0 && !best.incomplete

  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wider text-muted uppercase">
        <IconTicket className="size-4" /> {free ? 'Jízdenka' : 'Nejlevnější jízdné'} · {CATEGORY_LABELS[category]}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-lg font-bold">
          {free && <IconCheck className="size-5 text-brand" />}
          {best.label}
        </span>
        <span className="shrink-0 text-2xl font-black text-brand">{totalLabel(best)}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {best.parts.map((p, i) => (
          <Part key={i} p={p} />
        ))}
      </ul>

      {rest.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-sm font-semibold text-muted hover:text-white">
            Další možnosti jízdného ({rest.length})
            <span className={`transition ${open ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {open && (
            <ul className="space-y-2">
              {rest.map((o) => (
                <li key={o.id} className="rounded-xl ring-1 ring-white/10">
                  <button onClick={() => setExpanded(expanded === o.id ? null : o.id)} className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left">
                    <span className="text-sm font-semibold">{o.label}</span>
                    <span className="shrink-0 font-bold">
                      {totalLabel(o)}
                      {o.total > best.total && <span className="ml-1 text-xs font-normal text-subtle">(+{o.total - best.total} Kč)</span>}
                    </span>
                  </button>
                  {expanded === o.id && (
                    <ul className="space-y-2 px-2 pb-2">
                      {o.parts.map((p, i) => (
                        <Part key={i} p={p} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {options.some((o) => o.estimated) && <p className="mt-2 text-[11px] text-subtle">~ ceny ČD jsou orientační odhad podle ceníku ČD 2026.</p>}
    </div>
  )
}
