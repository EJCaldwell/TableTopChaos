# Gateway container — Caddy plus this repo's routing config.
#
# Deliberately minimal: the Caddyfile is the entire contribution. Pinned to a
# specific Caddy tag so a redeploy never silently changes proxy behaviour.
FROM caddy:2.8-alpine

COPY Caddyfile /etc/caddy/Caddyfile

# Railway injects PORT; the Caddyfile reads it with a localhost:8000 default so
# the same image works under docker-compose locally.
EXPOSE 8000

# Validate config at build time — a malformed Caddyfile fails the build instead
# of crash-looping the service after deploy.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
