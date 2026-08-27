# ---------------------------------------------------------------------------
# Daily campaign-cleanup trigger. All it needs is curl, so alpine rather than
# the postgres image the backup/migrate jobs use — this job never touches the
# database directly, and giving a cron container a database URL it does not
# need is a credential lying around for no reason.
#
# BUILD CONTEXT IS railway/cleanup/ (rootDirectory "railway/cleanup"), unlike
# backup and migrate, which need railway/scripts/ and so build from the repo
# root. Nothing outside this directory is copied in.
# ---------------------------------------------------------------------------
FROM alpine:3.20

RUN apk add --no-cache curl

COPY cleanup.sh /usr/local/bin/cleanup.sh
RUN chmod +x /usr/local/bin/cleanup.sh

CMD ["/usr/local/bin/cleanup.sh"]
