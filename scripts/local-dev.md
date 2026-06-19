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

---

## VERIFIED END-TO-END RECIPE (2026-06-19) — browser screenshots that actually work
This is the exact, tested sequence to run the app AND screenshot the real UI
(desktop + mobile) in this container. The harness's old route-based approach can't
work — the app is an auth-gated SPA with state (not URL) routing.

### Gotchas learned the hard way
- **Background processes die.** `nohup … &` from the Bash tool gets reaped between
  calls. Run the API server and `vite` with the tool's `run_in_background:true`
  (a detached `exec node …`), NOT `&`. Postgres (via `pg_ctl`) is fine — it daemonizes.
- **2FA gate.** Every data route 403s until the session has `twoFactorEnabled` AND the
  user's `totp_enabled` is true (the frontend's /auth/me drives the setup screen). For
  local testing, after logging in once via curl:
    - approve+verify the owner:  `UPDATE users SET status='approved', email_verified=true, totp_enabled=true WHERE email='efink@kprcenters.com';`
    - patch the live session:    `UPDATE session SET sess = jsonb_set(jsonb_set(sess::jsonb,'{twoFactorEnabled}','true'),'{twoFactorVerifiedAt}', to_jsonb(extract(epoch from now())*1000))::json;`
  The owner email defaults to `efink@kprcenters.com`; password = `ADMIN_PASSWORD`.
- **Single-origin.** The app calls same-origin `/api`, so run vite with
  `VITE_DEV_PROXY=http://localhost:3001` (added to vite.config.ts) to proxy to the API.
- **Playwright:** `npx playwright install --with-deps chromium` (set
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Reuse the curl session cookie via
  `ctx.addCookies([{name:"connect.sid", value:<cookie>, domain:"localhost", path:"/"}])`.

### Navigating to a deal in a screenshot script (state routing, not URLs)
  click `Portfolio (N)` → fill the `search deals…` placeholder → click the deal name.
  Tabs are buttons named e.g. `"Tenants & Sales ▾"`; click via JS (they can be
  covered) — `[...document.querySelectorAll("button")].find(b => b.textContent.trim().replace(/\s*▾\s*$/,"")===label).click()`.

### Capturing the WHOLE deal page
  The deal page delegates scrolling to an inner container (App.tsx: "DetailView owns
  the single scroll"), so `fullPage:true` alone clips to the viewport on mobile. Before
  screenshotting, neutralize the clip: set `overflow:visible; maxHeight:none` on every
  element and `height:auto` on the body — then `fullPage:true` captures everything.
  (For a faithful, undistorted shot, scroll naturally with `page.mouse.wheel` instead.)
  Tiles of a tall PNG are readable via `sharp(...).extract({left,top,width,height})`.
