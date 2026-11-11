/**
 * Cloudflare Pages Function: /api/fares/* → ceny FlixBus a RegioJet.
 * Logika je ve sdíleném server/fares.ts.
 */
import { fares } from '../../../server/fares'

export const onRequest = ({ request }: { request: Request }) => fares(request)
