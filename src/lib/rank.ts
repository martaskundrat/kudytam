/**
 * Výběr nejlepší varianty ze všech (spojení MHD/vlaky s chůzí nebo sdíleným kolem, cesta pěšky,
 * sdílené kolo na celou cestu). Ta je ve výsledcích vždy první.
 *
 * - Odjezd teď / v zvolený čas: v cíli nejdřív; při shodě nejzažší odjezd (méně čekání), pak méně přestupů.
 * - Příjezd do zvoleného času: všechny varianty dorazí včas, takže vyhrává nejzažší odjezd;
 *   při shodě dřívější příjezd, pak méně přestupů. Varianty, které do zvoleného času nedorazí, se nepočítají.
 * Taxi se do pořadí nepočítá (skoro vždy by vyhrálo) – zůstává jako samostatná možnost.
 */
export interface RankItem {
  key: string
  /** kdy vyrazit (ms) */
  start: number
  /** kdy budeš v cíli (ms) */
  end: number
  transfers: number
}

/** a je lepší než b? */
export function better(a: RankItem, b: RankItem, arriveBy: boolean): boolean {
  if (arriveBy) {
    if (a.start !== b.start) return a.start > b.start
    if (a.end !== b.end) return a.end < b.end
  } else {
    if (a.end !== b.end) return a.end < b.end
    if (a.start !== b.start) return a.start > b.start
  }
  return a.transfers < b.transfers
}

export function bestOf(items: RankItem[], arriveBy: boolean, deadline?: number): RankItem | null {
  const ok = arriveBy && deadline !== undefined ? items.filter((i) => i.end <= deadline + 60000) : items
  return ok.reduce<RankItem | null>((best, i) => (!best || better(i, best, arriveBy) ? i : best), null)
}
