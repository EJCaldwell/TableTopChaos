/**
 * _shared/cors.ts — CORS headers + preflight helper for the billing Edge
 * Functions.
 *
 * The web app (a browser SPA on a different origin than the functions host)
 * calls create-checkout-session and create-billing-portal-session with fetch,
 * so those functions must answer the browser's OPTIONS preflight and echo the
 * right CORS headers. The Stripe webhook is server-to-server and does not need
 * CORS, but sharing one module keeps things simple.
 */

/**
 * Permissive CORS headers. `*` origin is fine here because these endpoints
 * authenticate via the Authorization bearer token (not cookies), so there is no
 * ambient-credential CSRF surface to protect with a strict origin.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Returns a 204 preflight response when the request is an OPTIONS probe, else
 * null so the caller continues handling the real request.
 * @param req - The incoming request.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  return null
}

/**
 * Builds a JSON Response with CORS headers applied.
 * @param body - Any JSON-serializable payload.
 * @param status - HTTP status (default 200).
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
