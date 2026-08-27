# ---------------------------------------------------------------------------
# Nightly backup job. Built rather than using postgres:17-alpine directly
# because that image's ENTRYPOINT is docker-entrypoint.sh, which tries to
# initialise a fresh database cluster and exits with
#   "Database is uninitialized and superuser password is not specified"
# before any custom command runs. Clearing the entrypoint is the whole point of
# this file.
#
# pg_dump major version must be >= the server's (17.6), hence 17-alpine — an
# older client refuses to dump a newer server outright.
#
# BUILD CONTEXT IS THE REPO ROOT (rootDirectory "/" on the Railway service), not
# railway/backup/, because this image needs railway/scripts/ as well. Same shape
# as the migrate service. If you move this back to a narrower context, the
# erasure-record export below silently stops being copied in.
# ---------------------------------------------------------------------------
FROM postgres:17-alpine

ENTRYPOINT []

COPY railway/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Emits public.deleted_accounts as replayable INSERTs. This is the ONLY copy of
# the erasure record that survives a database restore: the tombstone table lives
# inside the database, so a backup taken before a deletion does not contain it.
COPY railway/scripts/92_export_tombstones.sql /scripts/92_export_tombstones.sql

CMD ["/usr/local/bin/backup.sh"]
