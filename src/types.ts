export interface LatLon {
  lat: number
  lon: number
}

export interface Place extends LatLon {
  name: string
  detail?: string
  /** název zastávky v jízdních řádech PID (u stanic z vyhledávání) */
  stopName?: string
  zones?: string[]
  types?: string[]
}

export interface Stop extends LatLon {
  id: string
  name: string
  platform?: string
  zones: string[]
  /** vzdálenost od výchozího bodu v metrech (vzdušnou čarou) */
  distance: number
}

/** GTFS route_type */
export type VehicleType = 'tram' | 'metro' | 'train' | 'bus' | 'trolleybus' | 'ferry' | 'funicular' | 'other'

export interface Departure {
  id: string
  tripId: string
  line: string
  vehicle: VehicleType
  headsign: string
  stop: Stop
  /** plánovaný odjezd (ms) */
  scheduled: number
  /** odjezd včetně zpoždění (ms) */
  predicted: number
  delayMin: number | null
  isNight: boolean
  wheelchair: boolean
  airConditioned: boolean
  canceled: boolean
}

export interface TripTarget {
  /** jméno zastávky, kde vystoupit */
  stopName: string
  /** příjezd do cíle (ms) */
  arrival: number
  /** pásma projetá spojem (od nástupu po výstup) */
  zones: string[]
}

/** Odjezd obohacený o výpočet chůze a dojezdu do cíle */
export interface Option {
  departure: Departure
  walkMeters: number
  walkMin: number
  /** za kolik minut je potřeba vyrazit (může být záporné = nestihneš) */
  leaveInMin: number
  reachable: boolean
  target?: TripTarget
}

export type PassengerCategory = 'adult' | 'student' | 'junior' | 'child' | 'senior60' | 'senior65' | 'ztp'

export type CouponType = 'litacka-praha' | 'litacka-zones'

export interface Coupon {
  id: string
  type: CouponType
  label: string
  /** pásma pokrytá kupónem */
  zones: string[]
  /** ISO datum konce platnosti */
  validUntil: string
}

export interface TravelMode {
  id: string
  label: string
  icon: string
  kmh: number
}

export interface Settings {
  travelModeId: string
  /** vlastní rychlost v km/h (použije se pro travelModeId === 'custom') */
  customKmh: number
  origin: Place | null
  destination: Place | null
  /** domov pro tlačítko „Domů“ */
  home: Place | null
  nearRadius: number
  wideRadius: number
  thresholdMin: number
  category: PassengerCategory
  coupons: Coupon[]
}
