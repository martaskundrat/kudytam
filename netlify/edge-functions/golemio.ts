/**
 * Proxy pro Golemio API. API klíč je uložený jen na serveru (proměnná GOLEMIO_API_KEY
 * v Netlify), takže se nedostane do prohlížeče a nehrozí problémy s CORS.
 *
 *   GET /api/golemio/status          -> { configured: boolean }
 *   GET /api/golemio/v2/...          -> přeposláno na https://api.golemio.cz/v2/...
 */
declare const Netlify: { env: { get(name: string): string | undefined } }

const ALLOWED = ['/v2/pid/departureboards', '/v2/gtfs/stops', '/v2/gtfs/trips/']

export default async (req: Request) => {
  const key = Netlify.env.get('GOLEMIO_API_KEY')
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/golemio/, '')

  if (path === '/status') return Response.json({ configured: !!key })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  if (!ALLOWED.some((p) => path.startsWith(p))) return new Response('Not found', { status: 404 })
  if (!key) return new Response('Golemio API key is not configured', { status: 503 })

  const upstream = await fetch(`https://api.golemio.cz${path}${url.search}`, {
    headers: { 'X-Access-Token': key, Accept: 'application/json' },
  })
  const headers = new Headers({ 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' })
  // odjezdy krátce, trasy spojů a zastávky déle
  headers.set('Cache-Control', path.startsWith('/v2/pid/') ? 'public, max-age=15' : 'public, max-age=3600')
  return new Response(upstream.body, { status: upstream.status, headers })
}

export const config = { path: '/api/golemio/*' }
