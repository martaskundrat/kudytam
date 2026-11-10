import { GolemioProvider } from './golemio'
import { MockProvider } from './mock'
import type { TransitProvider } from './types'

let status: Promise<boolean> | null = null

/** Zjistí, jestli má server nastavený Golemio API klíč. */
function liveDataAvailable(): Promise<boolean> {
  status ??= fetch('/api/golemio/status')
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((d: { configured?: boolean }) => !!d.configured)
    .catch(() => false)
  return status
}

let provider: Promise<TransitProvider> | null = null

/** Živá data PID, pokud je na serveru API klíč; jinak demo data. */
export function getProvider(): Promise<TransitProvider> {
  provider ??= liveDataAvailable().then((live) => (live ? new GolemioProvider() : new MockProvider()))
  return provider
}

export type { TransitProvider }
export { normalize } from '../text'
