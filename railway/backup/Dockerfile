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
# ---------------------------------------------------------------------------
FROM postgres:17-alpine

ENTRYPOINT []

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

CMD ["/usr/local/bin/backup.sh"]
