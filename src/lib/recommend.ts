import { firstWalk, transitLegs, type Journey } from './journeys'
import { better } from './rank'

export interface JourneyPick {
  /** doporučení při hledání podle příjezdu: nejpozdější odjezd */
  latest?: boolean
  journey: Journey
  /** o kolik min dřív dorazíš než nejlepším spojem z nejbližších zastávek */
  savedMin: number | null
  farStop: boolean
}

/**
 * Doporučení: nejdřívější příjezd. Pokud vede přes vzdálenější zastávku,
 * spočítáme, kolik ušetří oproti nejlepšímu spoji z nejbližšího okolí.
 * Při hledání podle příjezdu („být v cíli do…“) je nejlepší naopak nejpozdější odjezd,
 * se kterým tam dorazíš včas (při shodě kratší cesta a méně přestupů).
 */
export function recommend(journeys: Journey[], nearRadius: number, now: number, arriveBy = false): JourneyPick | null {
  const live = journeys.filter((j) => j.start >= now - 30000 && !transitLegs(j).some((l) => l.cancelled))
  if (!live.length) return null
  // stejné pravidlo jako pro všechny varianty (rank.ts): v cíli nejdřív, při shodě nejzažší odjezd
  const best = live.reduce((a, b) => (better({ ...b, key: b.id }, { ...a, key: a.id }, arriveBy) ? b : a))
  if (arriveBy) return { journey: best, farStop: false, savedMin: null, latest: true }
  // u sdíleného kola se počítá jen chůze ke stojanu
  const isNear = (j: Journey) => {
    const w = firstWalk(j)
    return (w?.bike ? w.bike.from.walkM : (w?.meters ?? 0)) <= nearRadius * 1.3
  }
  const bestNear = live.filter(isNear).reduce<Journey | null>((a, b) => (!a || b.end < a.end ? b : a), null)
  const farStop = !isNear(best)
  return { journey: best, farStop, savedMin: farStop && bestNear ? Math.round((bestNear.end - best.end) / 60000) : null }
}
