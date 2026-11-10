import { useSyncExternalStore } from 'react'
import type { Settings } from '../types'

/** Malý perzistentní store nad localStorage (bez externí knihovny). */
function createStore<T>(key: string, initial: T) {
  let state: T = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw) state = { ...initial, ...JSON.parse(raw) }
  } catch {
    /* poškozená data ignorujeme */
  }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(update: Partial<T> | ((s: T) => Partial<T>)) {
      const patch = typeof update === 'function' ? update(state) : update
      state = { ...state, ...patch }
      localStorage.setItem(key, JSON.stringify(state))
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export const TRAVEL_MODES = [
  { id: 'slow', label: 'Pomalá chůze', icon: '🚶', kmh: 3.5 },
  { id: 'walk', label: 'Chůze', icon: '🚶‍♂️', kmh: 5 },
  { id: 'fast', label: 'Svižná chůze', icon: '🏃‍♂️', kmh: 6.5 },
  { id: 'run', label: 'Běh', icon: '🏃', kmh: 9 },
  { id: 'scooter', label: 'Koloběžka', icon: '🛴', kmh: 14 },
  { id: 'bike', label: 'Kolo', icon: '🚲', kmh: 16 },
  { id: 'custom', label: 'Vlastní', icon: '⚙️', kmh: 5 },
] as const

export const settingsStore = createStore<Settings>('kudytam.settings', {
  travelModeId: 'walk',
  customKmh: 5,
  origin: null,
  destination: null,
  nearRadius: 400,
  wideRadius: 1200,
  thresholdMin: 10,
  category: 'adult',
  coupons: [],
})

export function useStore<T>(store: { get: () => T; subscribe: (l: () => void) => () => void }): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function speedKmh(s: Settings): number {
  if (s.travelModeId === 'custom') return s.customKmh
  return TRAVEL_MODES.find((m) => m.id === s.travelModeId)?.kmh ?? 5
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
