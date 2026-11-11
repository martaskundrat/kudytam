import { inCzechia } from '../lib/geo'
import type { LatLon } from '../types'

export type NavMode = 'foot' | 'bike' | 'car'

/**
 * Mapy.com URL API (https://developer.mapy.com/further-uses-of-mapycz/mapy-cz-url/): v telefonu otevře
 * aplikaci Mapy.com (není-li nainstalovaná, web); navigate=true rovnou spustí navigaci. Souřadnice lon,lat.
 */
export function mapyLink(from: LatLon, to: LatLon, mode: NavMode): string {
  const routeType = mode === 'car' ? 'car_fast' : mode === 'bike' ? 'bike_road' : 'foot_fast'
  return (
    'https://mapy.com/fnc/v1/route?' +
    new URLSearchParams({ mapset: 'outdoor', start: `${from.lon},${from.lat}`, end: `${to.lon},${to.lat}`, routeType, navigate: 'true' })
  )
}

/**
 * Google Maps URLs (https://developers.google.com/maps/documentation/urls/get-started#directions-action):
 * v telefonu otevře aplikaci Google Maps s trasou, jinak web. Souřadnice lat,lon.
 */
export function googleLink(from: LatLon, to: LatLon, mode: NavMode): string {
  const travelmode = mode === 'car' ? 'driving' : mode === 'bike' ? 'bicycling' : 'walking'
  return (
    'https://www.google.com/maps/dir/?' +
    new URLSearchParams({ api: '1', origin: `${from.lat},${from.lon}`, destination: `${to.lat},${to.lon}`, travelmode, dir_action: 'navigate' })
  )
}

/**
 * Navigovat: standardně Mapy.com; když trasa vede mimo ČR, i Google Maps (v zahraničí bývají přesnější).
 */
export function NavButtons({
  from,
  to,
  mode,
  label = 'Navigovat',
  primary = false,
  small = false,
}: {
  from: LatLon
  to: LatLon
  mode: NavMode
  label?: string
  primary?: boolean
  /** menší tlačítka (v seznamu úseků) */
  small?: boolean
}) {
  const abroad = !inCzechia(from) || !inCzechia(to)
  const cls = (main: boolean) =>
    `inline-block rounded-full ${small ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm'} font-bold transition active:scale-95 ${
      main ? 'bg-brand text-black hover:bg-brand-hover' : 'ring-1 ring-zinc-500 hover:ring-white'
    }`
  return (
    <>
      <a href={mapyLink(from, to, mode)} target="_blank" rel="noreferrer" className={cls(primary)}>
        {label}
        {abroad ? ' · Mapy.com' : ''}
      </a>
      {abroad && (
        <a href={googleLink(from, to, mode)} target="_blank" rel="noreferrer" className={cls(false)}>
          {label} · Google Maps
        </a>
      )}
    </>
  )
}
