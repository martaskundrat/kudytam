import type { Departure, LatLon, Stop, TripTarget } from '../../types'

export interface TransitProvider {
  readonly name: string
  readonly isDemo: boolean
  /** Nástupiště v okruhu `radius` metrů, seřazená podle vzdálenosti */
  nearbyStops(center: LatLon, radius: number): Promise<Stop[]>
  /** Odjezdy z daných nástupišť v příštích `minutesAfter` minutách */
  departures(stops: Stop[], minutesAfter: number): Promise<Departure[]>
  /**
   * Zjistí, zda spoj projíždí některou z cílových zastávek (po nástupu).
   * `targets`: normalizované jméno zastávky -> zobrazované jméno.
   * Vrací čas příjezdu a projetá pásma, nebo null.
   */
  tripTarget(dep: Departure, targets: Map<string, string>): Promise<TripTarget | null>
}

export function vehicleFromRouteType(t: number | string | undefined): Departure['vehicle'] {
  switch (Number(t)) {
    case 0:
      return 'tram'
    case 1:
      return 'metro'
    case 2:
      return 'train'
    case 3:
      return 'bus'
    case 4:
      return 'ferry'
    case 7:
      return 'funicular'
    case 11:
      return 'trolleybus'
    default:
      return 'other'
  }
}

/** "25:14:00" -> sekundy (GTFS dovoluje časy přes půlnoc) */
export function gtfsTimeToSec(t: string): number {
  const [h, m, s] = t.split(':').map(Number)
  return h * 3600 + m * 60 + (s || 0)
}

export function parseZones(z: unknown): string[] {
  if (typeof z !== 'string' || !z) return []
  return z
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
}
