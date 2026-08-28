# ---------------------------------------------------------------------------
# On-demand migration runner for the self-hosted stack.
#
# Build context is the REPO ROOT, so that supabase/migrations/ and
# railway/scripts/ can both be copied in. The migration files are baked into the
# image rather than fetched at runtime: the image IS the version of the schema
# being applied, so a deploy is reproducible and a rollback is redeploying an
# older image.
#
# ENTRYPOINT [] for the same reason as railway/backup: postgres:17-alpine's
# entrypoint tries to initialise a database cluster and exits before any custom
# command runs.
#
# psql major version must be >= the server (17.6), hence 17-alpine.
# ---------------------------------------------------------------------------
FROM postgres:17-alpine

ENTRYPOINT []

# Schema truth. Copied as a directory so a new migration only needs adding to
# the repo — no Dockerfile edit.
COPY supabase/migrations /migrations

# The grant sweep, which runs after every migration pass. No migration issues a
# table GRANT (hosted Supabase supplied them as project defaults), so without
# this a new table is readable by nobody and the app 401s on it.
COPY railway/scripts/90_grant_app_privileges.sql /scripts/90_grant_app_privileges.sql

# Re-applies right-to-erasure deletions that a database restore would otherwise
# resurrect (backups include auth.users). Idempotent; normally a no-op.
COPY railway/scripts/91_reapply_deletions.sql /scripts/91_reapply_deletions.sql

# The Phase 8.2 access-control matrix. Runs on every invocation, inside a
# transaction that never commits, and fails the deploy if any policy has been
# loosened — so a migration cannot ship a regression in the security model.
COPY railway/scripts/95_rls_matrix.sql /scripts/95_rls_matrix.sql

COPY railway/migrate/migrate.sh /usr/local/bin/migrate.sh
RUN chmod +x /usr/local/bin/migrate.sh

CMD ["/usr/local/bin/migrate.sh"]
