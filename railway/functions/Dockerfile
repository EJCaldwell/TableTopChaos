# ---------------------------------------------------------------------------
# The 7 Edge Functions, served by the same runtime hosted Supabase uses.
#
# Build context is the REPO ROOT (see docker-compose.yml / Railway root dir), so
# that supabase/functions/ can be copied in unmodified — including _shared/,
# which every function imports via relative paths like '../_shared/clients.ts'.
# Preserving that layout is what keeps the functions byte-identical to what
# `supabase functions deploy` would ship.
# ---------------------------------------------------------------------------
FROM supabase/edge-runtime:v1.67.0

# The 7 functions plus _shared. Copied to the path main/index.ts expects.
COPY supabase/functions /home/deno/functions

# The router (see main/index.ts for why a router is needed at all).
COPY railway/functions/main /home/deno/main

EXPOSE 8000

# `--main-service` boots the router, which then spawns one isolate per function.
CMD ["start", "--main-service", "/home/deno/main", "-p", "8000"]
