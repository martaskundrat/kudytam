/**
 * Proxy pro ceny dálkových dopravců. RegioJet odmítá dotazy z prohlížeče cizích webů (403 s hlavičkou Origin),
 * FlixBus jde přes stejnou cestu kvůli jednotnému cachování. Povolené jsou jen vybrané cesty (GET).
 *
 *   GET /api/fares/regiojet/locations        -> https://brn-ybus-pubapi.sa.cz/restapi/consts/locations
 *   GET /api/fares/regiojet/routes?...       -> https://brn-ybus-pubapi.sa.cz/restapi/routes/search/simple?...
 *   GET /api/fares/flixbus/search?...        -> https://global.api.flixbus.com/search/service/v4/search?...
 */
import { USER_AGENT } from './ua'

const ROUTES: Record<string, { url: string; headers?: Record<string, string>; maxAge: number }> = {
  'regiojet/locations': { url: 'https://brn-ybus-pubapi.sa.cz/restapi/consts/locations', headers: { 'X-Lang': 'cs' }, maxAge: 86400 },
  'regiojet/routes': {
    url: 'https://brn-ybus-pubapi.sa.cz/restapi/routes/search/simple',
    headers: { 'X-Lang': 'cs', 'X-Currency': 'CZK' },
    maxAge: 300,
  },
  'flixbus/search': { url: 'https://global.api.flixbus.com/search/service/v4/search', maxAge: 300 },
}

export async function fares(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const route = ROUTES[url.pathname.replace(/^\/api\/fares\//, '')]
  if (req.method !== 'GET' || !route) return new Response('Not found', { status: 404 })
  const upstream = await fetch(`${route.url}${url.search}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...route.headers },
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': upstream.ok ? `public, max-age=${route.maxAge}` : 'no-store',
    },
  })
}
