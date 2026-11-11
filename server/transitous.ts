/**
 * Proxy pro vyhledávač spojení Transitous (MOTIS 2) – https://transitous.org/api/
 * Podmínky Transitous vyžadují User-Agent s názvem aplikace a kontaktem,
 * který prohlížeč sám nastavit neumí, proto jde dotaz přes server.
 *
 *   GET /api/transitous/plan?... -> https://api.transitous.org/api/v1/plan?...   (vyhledání spojení)
 *   GET /api/transitous/trip?... -> https://api.transitous.org/api/v1/trip?...   (všechny zastávky spoje)
 *   GET /api/transitous/geocode?... -> https://api.transitous.org/api/v1/geocode?...   (adresy)
 *   GET /api/transitous/reverse-geocode?... -> …/api/v1/reverse-geocode?...   (adresa k GPS bodu)
 */
import { USER_AGENT } from './ua'

export async function transitous(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const endpoint = url.pathname.replace(/^\/api\/transitous\//, '')
  if (req.method !== 'GET' || !['plan', 'trip', 'geocode', 'reverse-geocode'].includes(endpoint)) return new Response('Not found', { status: 404 })

  const upstream = await fetch(`https://api.transitous.org/api/v1/${endpoint}${url.search}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'public, max-age=20',
    },
  })
}
