/**
 * main/index.ts — the Edge Runtime router for the self-hosted stack.
 *
 * Owns: mapping an inbound `/<function-name>` request onto one of the 7 functions
 * in supabase/functions/, each in its own isolated worker.
 *
 * WHY THIS EXISTS: every function in supabase/functions/ calls `Deno.serve`
 * itself, so they cannot be imported into one shared process — they would fight
 * over the port. Hosted Supabase avoids this by giving each function its own
 * isolate. `supabase/edge-runtime` reproduces that exact model locally, which is
 * why the 7 functions need **zero code changes** to run here. Do not refactor
 * them into exported handlers; that would fork them from what Supabase deploys.
 *
 * The gateway strips the `/functions/v1` prefix (see gateway/Caddyfile), so the
 * path this service receives is `/upload-media`, not `/functions/v1/upload-media`.
 *
 * Request flow:
 *   browser → gateway /functions/v1/upload-media
 *           → this router /upload-media
 *           → worker booted from /home/deno/functions/upload-media
 */

/** Where the Dockerfile copies supabase/functions/ to inside the image. */
const FUNCTIONS_ROOT = '/home/deno/functions'

/**
 * Per-worker resource ceilings. These are guardrails, not tuning: `upload-media`
 * previously hit an out-of-memory condition on large images (fixed by resizing
 * client-side plus a server guard), so a worker that regresses should die
 * cleanly and return 500 rather than take the whole service down.
 */
const WORKER_LIMITS = {
  memoryLimitMb: 256,
  workerTimeoutMs: 5 * 60 * 1000, // 5 min — import-campaign is the slow one.
  cpuTimeSoftLimitMs: 10_000,
  cpuTimeHardLimitMs: 20_000,
  noModuleCache: false,
  importMapPath: null,
}

/**
 * Function names this router will serve. An explicit allow-list, deliberately:
 * without it, a crafted path could ask the runtime to boot arbitrary directories
 * from the image. Keep in sync with supabase/functions/.
 */
const ALLOWED = new Set([
  'create-billing-portal-session',
  'create-checkout-session',
  'export-campaign',
  'export-journal',
  'import-campaign',
  'stripe-webhook',
  'upload-media',
])

Deno.serve({ port: 8000 }, async (req: Request) => {
  const url = new URL(req.url)

  // Railway healthcheck target. Answered without booting a worker so a broken
  // function never makes the whole service look unhealthy.
  if (url.pathname === '/healthz' || url.pathname === '/') {
    return new Response('ok', { status: 200 })
  }

  // First path segment is the function name.
  const name = url.pathname.split('/').filter(Boolean)[0]

  if (!name || !ALLOWED.has(name)) {
    return new Response(JSON.stringify({ error: `Unknown function: ${name ?? '(none)'}` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    // Boot a fresh isolate for this function and hand it the request untouched.
    //
    // CRITICAL: `req` is forwarded as-is, body unread. stripe-webhook verifies
    // its raw body against the Stripe-Signature header — reading, logging, or
    // re-serialising the body here would break signature verification and
    // silently fail every billing event.
    // @ts-expect-error — EdgeRuntime is injected by supabase/edge-runtime.
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_ROOT}/${name}`,
      envVars: Object.entries(Deno.env.toObject()),
      ...WORKER_LIMITS,
    })
    return await worker.fetch(req)
  } catch (err) {
    // Log server-side, return an opaque error: worker boot failures can contain
    // paths and env details that should not reach the browser.
    console.error(`[functions] ${name} failed:`, err)
    return new Response(JSON.stringify({ error: 'Function invocation failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
