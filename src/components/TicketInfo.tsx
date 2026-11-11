import { litackaLink } from '../lib/fares'
import { CATEGORY_LABELS, type Quote } from '../lib/tickets'
import type { PassengerCategory } from '../types'
import { fmtKc, IconCheck, IconTicket } from './ui'

const BUY_LINKS = {
  info: 'https://pid.cz/jizdenky/',
}

/** Jaká jízdenka je potřeba, kolik stojí a kde ji koupit. Aplikace sama nic neprodává. */
export function TicketInfo({ q, category, compact }: { q: Quote; category: PassengerCategory; compact?: boolean }) {
  const d = q.decision
  if (!d.needed)
    return (
      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-1 text-xs font-bold tracking-wider text-muted uppercase">Jízdenka · {CATEGORY_LABELS[category]}</div>
        <p className="flex items-center gap-2 font-semibold text-brand">
          <IconCheck className="size-5 shrink-0" /> {d.reason}
        </p>
      </div>
    )

  const p = d.product
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wider text-muted uppercase">
        <IconTicket className="size-4" /> Potřebuješ jízdenku · {CATEGORY_LABELS[category]}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-bold">{p.name}</span>
        <span className="shrink-0 text-2xl font-black text-brand">{fmtKc(p.prices.app)}</span>
      </div>
      <p className="mt-0.5 text-xs text-subtle">
        Pásma {p.zones.join(', ')} ·{' '}
        {q.assumedDuration ? 'cíl neznáme, počítáme s cestou do 30 min' : `cesta i s rezervou ~${q.durationMin} min`}
      </p>
      {d.note && <p className="mt-2 text-xs text-amber-300">{d.note}</p>}

      {!compact && (
        <>
          <ul className="mt-3 divide-y divide-white/5 rounded-xl bg-highlight text-sm">
            <li className="flex justify-between px-3 py-2.5">
              <span>
                Aplikace <b>PID Lítačka</b> <span className="text-brand">(nejlevnější)</span>
              </span>
              <b>{fmtKc(p.prices.app)}</b>
            </li>
            <li className="flex justify-between px-3 py-2.5">
              <span>Papírová – automat, předprodej</span>
              <b>{fmtKc(p.prices.paper)}</b>
            </li>
            {p.prague && (
              <li className="flex justify-between px-3 py-2.5">
                <span>SMS jízdenka</span>
                <b>{p.prices.sms ? fmtKc(p.prices.sms) : <span className="font-normal text-subtle">nelze (jen plné jízdné)</span>}</b>
              </li>
            )}
          </ul>
          {p.prague && p.prices.sms && <p className="mt-1.5 text-[11px] text-subtle">SMS jízdenka platí jen v pásmu P a ne ve vlacích.</p>}
          <div className="mt-3 flex gap-2">
            <a
              href={litackaLink().href}
              target={litackaLink().href.startsWith("intent:") ? undefined : "_blank"}
              rel="noreferrer"
              className="flex-1 rounded-full bg-brand py-2.5 text-center text-sm font-bold text-black transition hover:bg-brand-hover active:scale-95"
            >
              Koupit v PID Lítačce
            </a>
            <a
              href={BUY_LINKS.info}
              target="_blank"
              rel="noreferrer"
              className="rounded-full px-4 py-2.5 text-sm font-bold ring-1 ring-zinc-500 transition hover:ring-white active:scale-95"
            >
              Další možnosti
            </a>
          </div>
        </>
      )}
    </div>
  )
}
