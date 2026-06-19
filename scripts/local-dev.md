# Running the app locally (in the Claude dev container) — for runtime/UI testing

Lets Claude actually USE the app (click Owned, upload, etc.) to catch runtime bugs
before they hit Replit. Throwaway Postgres + a seed from a deals backup.

## 1. Postgres (runs as the `postgres` user; root can't run pg directly)
    PGBIN=/usr/lib/postgresql/16/bin; PGDATA=/tmp/kprpg
    rm -rf $PGDATA && mkdir -p $PGDATA && chown postgres:postgres $PGDATA
    sudo -u postgres $PGBIN/initdb -D $PGDATA -A trust -U postgres
    sudo -u postgres $PGBIN/pg_ctl -D $PGDATA -o "-p 5432" -l /tmp/pglog.txt start
    sudo -u postgres $PGBIN/createdb -p 5432 kpr
    export DATABASE_URL="postgresql://postgres@localhost:5432/kpr"

## 2. Schema
    (cd lib/db && node_modules/.bin/drizzle-kit push --config ./drizzle.config.ts)

## 3. Seed deals from a backup JSON ({deals:[...]}); insert id + data
    # node script: for each deal → INSERT INTO deals (id,data) ... (see history)

## 4. Server (admin accounts require 2FA; for testing use a non-admin or patch the
##    session row's twoFactorEnabled=true, and approve the user in the users table)
    (cd artifacts/api-server && node build.mjs)
    cd artifacts/api-server && DATABASE_URL=... PORT=3001 SESSION_SECRET=x \
      SECURE_COOKIES=false ADMIN_PASSWORD=localtest123 node dist/index.mjs &

## 5. Populate tenant_index: PUT each deal back (requireAuth) — the PUT handler
##    rebuilds the index (and skips trashed deals).

## 6. Frontend: cd artifacts/om-database && vite dev  (proxy /api → :3001)
