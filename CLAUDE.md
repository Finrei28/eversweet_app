# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three independent npm projects in one git repo — there is no workspace root, no shared
lockfile, and no cross-imports between them. Each has its own `package.json`,
`package-lock.json`, `node_modules` and `.env`, so **always run npm from inside the app
directory**.

| Directory   | What it is                                                             |
| ----------- | ---------------------------------------------------------------------- |
| `backend/`  | Express 5 + Prisma (PostgreSQL) + Socket.IO API. Serves both apps and the separate Eversweet website. |
| `frontend/` | Customer Expo / React Native app (`nz.co.eversweet`, "Eversweet").      |
| `admin/`    | Staff kitchen Expo app ("Eversweet App Manager") — order alarms and BLE receipt printing. |

Eversweet is a New Zealand dessert shop. Everything is single-store, NZD, GST-inclusive,
and `Pacific/Auckland` wall-clock time.

### The database schema lives in another repo

`backend/prisma/` has no `migrations/` directory, which makes this look like a
`prisma db push` project. **It is not.** The migration history — 80-odd migrations — belongs
to the separate Eversweet **website** project at `C:\Personal Projects\eversweet`, which
shares this database. The two `prisma/schema.prisma` files are kept **byte-for-byte
identical**.

So never run `prisma migrate` here, and never hand-edit `backend/prisma/schema.prisma` on
its own. To change the schema:

```bash
# 1. Edit the schema in the website project
cd "C:/Personal Projects/eversweet"
vim prisma/schema.prisma

# 2. Generate the migration there. --create-only when the SQL needs hand-writing,
#    which it does for anything destructive.
npx prisma migrate dev --name <name>          # or: npm run db:generate
npx prisma migrate dev --create-only --name <name>

# 3. Mirror the schema back, byte for byte
cp prisma/schema.prisma "<this repo>/backend/prisma/schema.prisma"

# 4. Regenerate the client here
cd "<this repo>/backend" && npx prisma generate
```

Production is `npm run db:migrate` (`prisma migrate deploy`) from the website project,
against `DIRECT_URL` — DDL through the pooled `DATABASE_URL` is unreliable.

`npx prisma db push` **is** still how the local and CI test databases are built here; that
is a separate database and does not touch the migration history.

House style for a migration is set by
`prisma/migrations/20260908000000_offer_audience_and_redemption_rekey/migration.sql`: a
header saying what Prisma's own generated SQL would have done and why this differs, then
add-backfill-**assert**-drop, with the assertion load-bearing. Prisma wraps each migration
in a transaction, so a failed assertion rolls the whole thing back rather than leaving a
half-migrated table. Name new indexes and constraints the way Prisma would, so a later
`migrate diff` reports empty instead of proposing a rebuild.

Mind the version skew: the website is on Prisma 5.14, this backend on 6.19. One schema, one
database, migrations authored from the website — so don't reach for 6.x-only syntax.

## Commands

### backend/

```bash
npm run dev                      # nodemon src/index.ts
npm test                         # vitest run  (this is what CI runs)
npm run test:watch
npx vitest run src/lib/prepTimes.test.ts       # one file
npx vitest run -t "refuses a duplicate"        # one test by name
npx tsc --noEmit                 # CI type check
npm run build                    # npm install && tsc -p tsconfig.build.json
npx prisma generate              # runs automatically on postinstall
npx prisma db push               # push schema (how CI builds the test DB)
npm run email                    # react-email preview of src/email on :3001
```

Integration tests (`*.integration.test.ts`) need `TEST_DATABASE_URL` pointing at a
Postgres whose **database name contains "test"** — `resetDatabase` truncates every table
and refuses to run otherwise. Without that variable the integration suites skip and the
unit suites still run. `setup.ts` copies it over `DATABASE_URL`, so `lib/db` connects to
the test database with no injection. `fileParallelism` is off because the suites share
one database.

`resetDatabase` also **puts the shop's hours back** (`test/shopHours.ts`, the rows the
`TradingHours` migration seeds) and clears the hours cache. Without that, every weekday
reads as closed and every order a test places is refused. A test that changes the hours
calls `invalidateTradingHours()`.

**Tests must never reach Stripe or Redis.** `setup.ts` runs `dotenv.config()` first and only
fills in placeholders for what is *missing*, so on a developer machine `STRIPE_SECRET_KEY`
and `REDIS_URL` are the real ones from `backend/.env`. The doubles:

- **Stripe:** `test/stripeStub.ts`. Mock the SDK with
  `vi.mock("stripe", async (importOriginal) => (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()))`
  (the `.js` is required: NodeNext resolution needs an extension, and Vite maps it to the
  `.ts`). Then program the `stripeApi` spies and call `resetStripeStub()` in `beforeEach`.
  The SDK's real error classes stay available, so `resourceMissing(actual)` builds a genuine
  `resource_missing`. Webhooks are verified for real: sign the payload with
  `Stripe.webhooks.generateTestHeaderString` and set `STRIPE_WEBHOOK_SECRET`.
- **Redis:** `test/redisStub.ts`, mocked through a getter,
  `vi.mock("../lib/redis", () => ({ get redis() { return redis.redis } }))`, because
  `vi.mock` is hoisted above the imports.
- **Auth:** `tokenFor(userId)` (`test/db.ts`) mints a token, but the user row has to exist.
  Authentication reads the role and password-change time from the database, not the token.
- A test that mocks `lib/db` without stubbing `lib/sessionCache` will reach for the real
  `REDIS_URL`; see `lib/orderAnnounce.integration.test.ts`.

**Times in the local test database.** The `C:\pg16test` cluster's session time zone is New
Zealand, while Prisma stores `DateTime` columns as UTC `timestamp(3)`. A raw `now()`, or a
JS `Date` passed through `$executeRaw`, is converted to the session zone and lands 12–13
hours out. Set times through the Prisma model API instead: it accepts an explicit
`updatedAt`.

**The local test Postgres lives at `C:\pg16test`.** This machine has no Docker — WSL2
cannot start, so the container route is unavailable — and the test database is instead a
standalone PostgreSQL 16.4 cluster there: binaries in `pgsql\`, data in `data\`, log in
`server.log`. It is deliberately outside OneDrive, because syncing a live data directory
corrupts it. `backend/.env` already carries the matching `TEST_DATABASE_URL`, so
`npm test` runs the whole suite with nothing exported.

It is not registered as a Windows service, so it needs starting after a reboot:

```bash
"C:/pg16test/pgsql/bin/pg_ctl.exe" -D "C:/pg16test/data" \
  -l "C:/pg16test/server.log" -o "-p 5432 -c listen_addresses=127.0.0.1" start
```

Two things follow from `TEST_DATABASE_URL` being set permanently. The integration suites
now **fail rather than skip** when the server is down, so check it is running
(`pg_isready -h 127.0.0.1 -p 5432`) before believing a wall of connection errors. And
`pg_ctl start` does not return in a tool-driven shell — the server inherits the pipe —
so run it in the background and verify with `pg_isready` separately.

**Rebuilding that database after a schema change needs care: `DATABASE_URL` in
`backend/.env` is production Supabase.** `prisma db push` reads it, and `DIRECT_URL`
alongside it, so running it from `backend/` pushes the schema at the live database.
`setup.ts` only redirects `DATABASE_URL` for vitest; nothing protects a CLI invocation.
Push from a throwaway directory holding a copy of `schema.prisma` and a `.env` carrying
only the test URL for **both** variables, and check the "Datasource" line names
`eversweet_test` before trusting it.

The website repo has its own test database on this same cluster — `eversweet_web_test`,
deliberately separate, because both suites truncate every table and would otherwise clear
each other's rows mid-run.

`SQL_TIMING=1` logs per-statement and per-operation timings (verbs only, never parameters
or values) and enables the startup latency probe — safe to turn on in production for a
few minutes.

### frontend/

```bash
npm start                        # expo start
npm run android / npm run ios / npm run web
npx tsc --noEmit                 # CI type check
npx expo lint                    # CI lint (errors fail, warnings don't)
npx eslint app/checkout.tsx      # one file
npm test                         # jest (jest-expo), CI runs this
npm run test:watch
npx jest _components/prizeCard   # one file
npm run verify:lock              # see below
```

- **Device timezones:** the pick-up time tests in `lib/checkoutHelpers.test.ts` must pass
  with the device anywhere. Jest fixes the zone when its workers start, so each zone is its
  own run, and the file checks that the zone took. **Don't set `TZ` in Git Bash**
  (`TZ=America/Los_Angeles npx jest`): it drops a `TZ` value containing a slash on its way
  to Windows programs, so that silently runs in the machine's own zone. Let node set it,
  which works from any shell:

  ```bash
  node -e 'for (const tz of ["UTC","America/Los_Angeles","Asia/Kolkata"]) require("child_process").execSync("npx jest lib", { stdio: "inherit", shell: true, env: { ...process.env, TZ: tz } })'
  ```
- `npm test` is `jest` (exits) and `npm run test:watch` is `jest --watchAll`, matching
  `admin/`. It used to be `--watchAll` with no test files, which never exited; Frontend CI
  now runs `npm test -- --ci`.
- **Prefer `npm ci` over `npm install` here, especially on Windows**: a plain install
  prunes the pinned `@emnapi/*` devDependencies and breaks Frontend CI.
- Run `npm run verify:lock` after any change to the `overrides` block or the lockfile. EAS
  builds with an older npm than local, npm does not record `overrides` in lockfileVersion
  3, and npm versions disagree about how to apply them — a lock that installs fine under
  npm 11 can fail `npm ci` on EAS. The script walks the lock and then runs a real `npm ci`
  under npm 9 and 10 in a temp dir (`--dry-run` does not reproduce the failure).

### admin/

```bash
npm start / npm run android / npm run ios
npm test                         # jest (jest-expo)
npm run test:watch
npx jest services/receipt.test.ts
npx jest -t "test name"
npm run lint
```

`patch-package` runs on postinstall. Printer work needs a physical device.

### CI

Workflows live only in the **root** `.github/workflows/` (GitHub reads nothing else), are
path-filtered per app, and `cd` into the app directory. Backend CI = `tsc --noEmit`,
`npm audit --audit-level=critical`, and vitest against a real `postgres:16` service (Redis
is stubbed in-process). Frontend CI = `tsc --noEmit`, `expo lint`, and a report-only
audit. Both audits are gated at `critical` with the reasoning written into the workflow
files — read those comments before "fixing" an advisory.

## Architecture

### Backend

**`app.ts` vs `index.ts`.** `app.ts` is the HTTP surface alone — routes and middleware,
nothing that listens. `index.ts` is what opens the port, builds the Socket.IO server and
schedules cron. This split exists so tests can mount the real middleware chain
(authentication, rate limiting, idempotency) via supertest without starting a server. The
same reasoning put the socket instance in `lib/socket.ts` behind `setIo`/`getIo`: a
controller must be importable without booting the app. Preserve that — never import
`index.ts` from a controller or lib.

Route groups and how they authenticate:

| Mount                                           | Auth                                    |
| ----------------------------------------------- | --------------------------------------- |
| `/api`                                          | public client data (menu, hours, offers, legal text) |
| `/api/auth`                                     | mixed — signup/signin are public and rate-limited, the rest take a bearer token |
| `/api/cart`, `/api/notification`, `/api/stripe` | bearer token                            |
| `/api/admin`                                    | bearer token + ADMIN role (`middleware/authorisation`) |
| `/api/internal`                                 | server-to-server only; shared secret in `x-service-secret`, compared with `timingSafeEqual` over hashes. An unset `INTERNAL_SERVICE_SECRET` refuses everything. This is how the website announces its own paid orders to the kitchen, and how its `/admin/winners` assigns prizes and settles a missed month. |

The Stripe webhook is mounted **before** `express.json()` with a raw body parser — a
parsed body cannot be verified against Stripe's signature.

**Latency is the dominant cost, not query count.** The API runs in Singapore and Postgres
in Sydney; one round trip costs roughly 0.9s. Everything downstream follows from that:
cart transactions use `{ timeout: 20_000, maxWait: 10_000 }` rather than Prisma's 5s
default; `lib/sessionCache` exists purely to remove the one database round trip that every
authenticated request used to make; request timing is measured with a Prisma `$extends`
wrapper rather than the `query` event, because the event fires in a different async
context and reported `db=0ms` for everything. When optimising, cut round trips before
cutting rows.

**Redis is an accelerator, never a dependency.** `lib/cache`, `lib/sessionCache` and
`middleware/idempotency` all bound every call and fall through to Postgres on timeout or
error. Keep new cache code in that shape, and note the direction it fails in: the session
cache stores "this user's password-change time **and role**" so a miss falls through to a
*check*, rather than storing "this token was revoked" where an eviction would silently
honour a retired token. Order idempotency is likewise belt-and-braces — Redis is the fast
path, the unique constraint on `Order.paymentIntentId` is the guarantee.

**Sessions.** `lib/session.verifySession` is the one token check, shared by
`middleware/authentication` and the socket handshake. It does three things:
- verifies the JWT;
- reads `{ passwordChangedAt, role }` from the cache or the user row;
- rejects tokens issued before the last password change, and tokens for deleted accounts.

`req.role` is the role **on record**, not the token's. Tokens live 90 days (180 for staff),
so the token's role would outlive a demotion. A role change made outside this API reaches
requests within the cache's 60s TTL. A failure to check answers 500, never a pass.

**The rate limiters fail to memory, not to open.** Every limiter in
`middleware/rateLimiter` uses `ResilientStore` (`middleware/resilientRateLimitStore`):
Redis while it answers, a per-process `MemoryStore` while it does not, with each command
bounded at 500ms and a 10s cooldown before Redis is tried again. They used to talk to
`RedisStore` directly, which made Redis a hard dependency of sign-in, sign-up, OTPs, prize
codes and every `/api/internal` route — an unreachable Redis was a hung request and then a
500 on all of them. Dropping the limit instead (`passOnStoreError`) would hand the outage to
anyone brute-forcing a sign-in, so the limits stay in force, just counted per instance until
Redis is back.

One trap to know if you touch this: `rate-limit-redis` caches the *promise* of loading its
Lua scripts in `init`, and a rejected promise stays rejected. With `RedisStore` alone a Redis
blip at boot broke limiting until the process restarted, however soon Redis recovered.
`ResilientStore` calls `init` again on recovery rather than trusting that promise — keep it
doing so.

**Minimum app version.** `middleware/appVersionGate` (mounted globally in `app.ts`, right
after `requestTiming`) retires customer app builds. The app sends `X-App-Build` and
`X-App-Platform` on every request; below `MIN_APP_BUILD_<IOS|ANDROID>` it gets
`426 { code: "APP_UPDATE_REQUIRED" }` and puts up a blocking screen, and below
`RECOMMENDED_APP_BUILD_<IOS|ANDROID>` it is let through carrying
`X-App-Update-Recommended` and offers a dismissible nudge. Thresholds are in
`lib/appVersion`; unset gates nothing, which is how they ship.

- **Everything about it fails open.** A missing, unreadable or duplicated header is waved
  through, because the staff app and the website call this same server on these same paths
  and send none. `/api/admin` and `/api/internal` are skipped outright, and the Stripe
  webhook is already out of reach — it is registered above `express.json()`, and Express
  matches in registration order. That is the opposite direction from
  `middleware/serviceAuth`, deliberately: an unset secret costs one integration, a gate armed
  by mistake blanks every customer at once.
- **It shipped before the customer app launched**, so unlike most such gates there is no
  install base it can never reach. Every build a customer has ever had carries it. Keep it
  that way: anything that would let a build talk to this server without the header puts that
  back.
- **Build numbers, not `expo.version`.** EAS owns the build number (`appVersionSource:
  "remote"` with `autoIncrement`) and never touches `expo.version`, which changes only when
  somebody edits `app.json`. Bump `expo.version` on **every** store submission — the listing,
  crash reports and support need it — but the gate does not depend on anyone remembering,
  and is unaffected by two releases claiming the same version.
- **The block is not one-way.** A 200 with no recommendation header means "up to date" and
  lifts the wall; once it is up nothing else in the app is fetching, so the update screen's
  "I've already updated" re-check is the only thing that would notice a threshold rolled
  back. Only the nudge's dismissal is persisted, never the block.
- **The gate is only as prompt as the first request.** `app/_layout.tsx`'s launch
  `getAnnouncements()` is what trips it before the splash hides; if that call ever goes, a
  blocked build looks normal until the customer touches something.
- **Take the number from the store, not from EAS.** `eas build:version:get` answers "what
  will the next build be" — EAS increments its counter when a build *runs*, not when one is
  submitted, so a build made and never shipped leaves it ahead of anything a customer has.
  Setting `MIN_*` from it blocks everybody, newest release included. The live number is the
  one App Store Connect shows against the released version and the one in the Play Console's
  release.
- **Raising `MIN_*`:** only to a build already live in that store, never above one still in
  staged rollout on Android, and outside Auckland trading hours — a block landing mid-checkout
  unmounts `checkout.tsx` and leaves an authorised hold the stranded-payment sweep releases
  within 30 minutes. Remember TestFlight builds are production builds and spend the same
  counter, so a minimum can lock testers out too. Let `RECOMMENDED_*` lead by a week or two.
  Rollback is one env change and a restart, which is the whole argument for env over a table.
- The in-band `authoriseOnly` 426 in `createPaymentIntent` stays. This gate is configuration
  and can be switched off by an unset variable or a header stripped in front of the server;
  that one is proved by the request itself and cannot. Both share the code, and the app blocks
  on either. **A capability one build lacks gets its own status and code, never a 426** —
  `APP_UPDATE_REQUIRED` means the whole build is unsupported.

**`lib/db.ts`** exports an extended client cast back to `PrismaClient`. Type signatures
that accept a client must use the exported `Db` / `DbTransactionClient`, not Prisma's own
`TransactionClient`, which describes an unextended client.

**Cart row lock order — `OfferRedemption` → `Loyalty` → `Cart`.** Any transaction touching
more than one of those tables must take them in that order; taking them in opposite orders
is what deadlocked add-vs-remove (Postgres `40P01`). Nothing enforces it but the comment in
`cart.controller.ts` and the tests.

**Pricing is server-derived.** `lib/cartPricing.calculateCartPrice` is the single
definition of what a cart costs, recomputed from the rows every time rather than read from
`Cart.totalPriceInCents` (which drifts). Requests may carry `priceInCents` /
`discountedAmountInCents` / points fields — the zod schemas accept them for compatibility
with builds already on people's phones, but the server recomputes every figure from the
dessert, promo, membership and offer rows and ignores what was sent. GST is *extracted*
from the inclusive price with `gstFromInclusive` (×3/23), never applied on top.

**Offer rules live in three libs, and none of them is guessable from the rows.** Offers are
authored in the website's `/admin` and only ever read here.

- **`lib/offerAvailability`** — `isOfferLive(offer)` for a row you have, `liveOfferWhere()`
  as a Prisma fragment for one you are fetching. Both bounds **inclusive**, `NULL` means
  "no bound", archived is never live. It mirrors `isWithinActiveWindow` in the website
  repo: if the two drift, the admin's status badge says LIVE on an offer this server
  refuses. Every path that serves or prices an offer gates on it — three list queries and
  three by-id fetches. The by-id ones had no active check at all until 2026-09-12, so a
  paused offer repriced a cart. The dates are **whole Auckland days** as the website stores
  them: `startsAt` midnight at the start of the first, `endsAt` 23:59:59.999 on the last, so
  the plain inclusive comparison serves the whole end day. Until 2026-09-17 the website
  stored midnight at the *start* of the end day and every offer stopped a day early; that
  was fixed where the dates are written, plus a migration for existing rows. Don't add a day
  here too.
- **`lib/offerPricing.offerUnitPriceInCents`** — the one definition of what an offer unit
  costs. `itemPriceInCents` is checked for null and never for truthiness, because **0 is a
  real price**: it is how an offer gives an item away. `discountAmount` is **whole
  percent** since the 2026-09-12 migration; it was a `Decimal` fraction before, and the
  old `1 - x` reading priced a 20% offer at -19× list.

  Since `20260914000000_offer_pricing_rules` the database enforces what was previously
  only convention: `Offer_exactly_one_price` makes `itemPriceInCents` and `discountAmount`
  mutually exclusive, and `discountAmount` must be 1–100. Both are invisible to Prisma and
  **absent from the test databases**, which are built with `db push` — so the suites prove
  the code, not the constraints.
- **`lib/offerAudience`** — who an offer is for, plus the refusal wording.

`OfferRedemption.status` becomes `REDEEMED` only when `used` reaches `limit`. Writing it on
every use made `limit > 1` meaningless on any offer with requirements, because the gate
keys off `status`. Two consequences, both load-bearing: `redeemOfferForUser`'s create
branch must refuse an offer that has requirements (no row means nobody unlocked it — and
the admin's **Close run** *deletes* rows, which is exactly that state), and all four
release paths must write `status: "AVAILABLE"` alongside `used: { decrement: 1 }` or a
gated offer is locked out for good. That is safe unconditionally: redeeming refuses at
`used >= limit`, and every release is guarded by `used > 0`.

**Never `include` an `Offer` or `OfferRedemption` — list the fields.** Prisma selects every
scalar the generated client knows about, so a client built either side of an unapplied
migration asks for a column the database lacks: Postgres `42703`, and on 2026-09-12 that
took out the offers screen and offer add-to-cart over `renewsAt`, a column nothing read.
The window columns are deliberately kept off the wire too — the server gates on them, and
sending them invites the app to form a second, drifting opinion. `showOffers` asserts its
exact response shape, because a hand-written select can drop a field the app needs in one
line and the screen would just render blanks.

**Order creation.** `POST /api/auth/createOrder` is wrapped in `idempotency("createOrder")`,
keyed on the `Idempotency-Key` header and falling back to the payment intent for older
builds. A retry that lost a race returns the customer's own existing order rather than
"cart is empty".

**Every card order is a hold, captured last.** `createPaymentIntent` creates the payment
intent with `capture_method: "manual"`, so confirming in the app only authorises the card.
- **The update gate:** the app must send `authoriseOnly: true`. A build that predates holds
  reads one as a failed payment, so without the flag the endpoint answers **426**
  `APP_UPDATE_REQUIRED` ("Please update the Eversweet app to pay by card") before touching
  Stripe. The app has no over-the-air updates, so this gate is the only way to reach
  installed builds. Points-only orders need no card and work on every build.
- **Rollout order:** ship the app build before deploying a server change here. The app
  accepts `Succeeded` as well as `RequiresCapture`, so it works against an older server.

`lib/orderPayment.settleOrderPayment` runs first inside the order transaction, under a
Postgres advisory lock on the payment intent id (`lockPayment`). The lock is held until
commit, so settling, capturing, releasing and refunding one payment never interleave.
Checks, in order:
- **Ownership:** the intent must be the caller's Stripe customer's (else 404).
- **Tag:** it must carry the `purpose: "app_order"` metadata. Membership invoices share the
  customer, so the customer check alone would let one pay for, or be refunded as, an order.
- **`requires_capture` (the normal case):**
  - The hold must equal the cart's `payableInCents` in NZD.
  - A mismatch or a pick-up time that has become invalid **releases the hold**
    (`paymentIntents.cancel`): `400/409 { released: true }`, no order, nothing charged.
  - Otherwise `createOrder` writes the order and captures with `captureOrderPayment` as the
    **last step before commit**, keyed `order-capture:<id>`. A failed capture rolls the
    order back; a hold already gone answers 409 `released`.
- **`succeeded`** reaches here only through the capture-to-commit gap, since Stripe and
  Postgres can't commit together.
  - A retry with a matching cart is accepted with no second capture, even if the pick-up
    time has since passed.
  - A mismatch is **refunded in full** (`refundOrderPayment`, keyed `order-refund:<id>`),
    never accepted at the amount paid.
  - A refunded payment is refused: a refund leaves the status at `succeeded`, so check
    `latest_charge.amount_refunded`.
- **`canceled`:** 409 `released`.

**The stranded-payment sweep** (`lib/strandedPayments`, every 5 minutes) mops up what
`createOrder` never finished, using the same lock and keys. It looks at payments older than
30 minutes:
- It releases holds that have no order, and captures any hold that does (which should never
  happen, so it logs loudly). Holds are found by Stripe search, which lags about a minute.
- It refunds taken payments that have no order, looking back 48 hours. Those are found by
  **listing charges** in that window rather than searching for payments created in it - see
  below - so that half is immediately consistent.

**It settles the website's payments too** (`metadata.source = "website"`, alongside
`purpose = "app_order"`; `ORDER_PAYMENT_TAGS`). Since 2026-09-18 the website holds the card
when its customer pays. Its own `createNewOrder` (`src/server/websiteOrder.ts` in that repo)
captures as the last step before the order commits, under this advisory lock, with the same
`order-capture:<id>` and `order-refund:<id>` keys and parameters. Nothing on Vercel runs on a
timer, so this sweep is what lets go of an abandoned website checkout's hold. Two things
follow:

- **Both halves measure from when the money moved, not from when the payment was created.**
  The website creates its payment when the checkout details are filled in, possibly long
  before Pay, so the payment's own `created` says nothing about when the card was used.
  - *Holds:* search can only filter on the payment's `created`, which narrows the list; the
    decision is then `latest_charge.created` (`heldLongEnoughAgo`). Going by `created` alone
    would release a hold seconds old, before its order is written.
  - *Refunds:* there is no search for them at all. `chargesTakenBetween` lists charges, and
    their payments are what the sweep settles. Searching by the payment's `created` put a
    payment made against an older intent outside the window on every run, for good - nobody
    would ever refund that customer.
  - *And the refund window is on the **capture**,* not on the charge's own `created`. These
    are manual captures: a charge is created when the card is authorised and the money moves
    later, when `createOrder` captures the hold. `capturedAt` reads the balance transaction,
    which Stripe creates at that moment. Both bounds are about the money: half an hour to
    become an order before it is handed back, and anything taken before the window out of
    reach, so a run cannot reach back into payments the shop settled by hand. Charges can
    only be *listed* by the authorisation, so the search looks back `MAX_HOLD_MS` (Stripe's
    seven-day hold life, the furthest a capture can trail its authorisation) further than
    the window, and the capture time decides.
  - Because those charges are **every** charge on the account, the payment is checked for its
    tag (`isOrderPayment`) before anything is refunded. Without that the sweep would refund
    membership invoices, which have no order either.
- **Refunds of website payments carry no metadata** (there is no `userId`). The website sends
  exactly those parameters under the same key, and Stripe refuses a reused key with different
  ones. Change the keys or parameters in both repos or neither.

**What the app does** (`app/checkout.tsx`):
- `PaymentReleasedError` shows "You haven't been charged"; `PaymentRefundedError` shows
  "Payment refunded".
- `checkPaymentStatus` returns `authorised` (on hold) and `released` (let go) alongside
  `success`, `refunded` and `pending`.
- A payment that is authorised or succeeded but has no order offers "Place order", which
  resends the same order (same payment intent, same idempotency key) from `pendingOrderRef`.
- Recovery on returning to the foreground waits while a checkout is still running, for
  example on return from 3D Secure.

Payment intents created before `createPaymentIntent` started tagging them are refused and
logged, so **deploy changes here while nobody is mid-checkout**.

**Stripe.** One client, `lib/stripeClient` (with `idOf` for fields Stripe may send
expanded); `lib/stripeErrors` has `orNullIfMissing`, which turns `resource_missing` into
null. Rules the endpoints follow:
- A card, setup intent or payment intent must belong to the caller's `stripeCustomerId`.
  One that belongs to someone else answers exactly like a missing one (404).
- `removeCard` refuses the card a membership renews on (409). That card is
  `membershipPaymentMethodId`: the subscription's own default, else the customer's invoice
  default, which is the one `createMembership` sets.
- `getOrCreateCustomerId` creates a customer only when the stored one is
  `resource_missing`. Any other Stripe error is rethrown: a blip used to replace the
  customer and orphan a member's cards and subscription.
- It also writes the user's name, email and phone onto the customer's **top-level** fields
  whenever they differ (`lib/stripeCustomer`), because those are what the Stripe Dashboard
  shows against a payment. Customers used to carry them only in metadata. The sync is
  best-effort and never throws, and a new customer is created bare first, so a detail
  Stripe refuses costs only the label, never the payment. `src/scripts/syncStripeCustomers.ts`
  (dry run by default, `--apply` to write) backfills customers that are never used again.
  The website creates Stripe customers of its own, marked `source: "website"` and not
  tied to a user.
- `createPaymentIntent` always holds in NZD, whatever `currency` says (see **Order
  creation**).
- `createMembership` always uses the plan's own price; a different `stripePriceId` gets 409.

**Versions:** the SDK pins `2025-08-27.basil`. The webhook endpoint (and the account
default) is `2025-02-24.acacia`. The `2020-08-27` traffic is the ephemeral key minted for
the mobile payment sheet. Don't upgrade the account default: it would change webhook
payload shapes.

**Order lifecycle to the kitchen.** `lib/orderTiming` + `lib/prepTimes` are the one place
prep durations live (item count → prep minutes → kitchen lead time → customer quote); this
used to be duplicated in three codebases that disagreed. `lib/orderRelay` schedules the
announcement, and two socket events go to `ADMIN_ROOM` and only `ADMIN_ROOM`:
`order-received` is silent and populates the Upcoming list, `new-order` is the alarm and
fires when preparation is actually due — which for a scheduled order can be hours after
payment. A two-minute cron re-sweeps as a backstop for anything a restart dropped. Socket
room membership is decided by the role **on record**, not the JWT's: `lib/socketAuth` runs
the same `lib/session.verifySession` as the HTTP middleware at the handshake, a one-minute
cron (`recheckAdminSockets`) sends away any kitchen socket whose session no longer holds
(demoted, password reset, token expired), and `resetPassword` disconnects that user's
sockets at once. A check that cannot be made (database down) keeps the socket rather than
silence the kitchen.

**Pick-up times.** One rule, implemented in the website (`src/lib/pickUpTimes.ts`), here
(`lib/tradingHours.ts`) and in the customer app (`frontend/lib/checkoutHelpers.ts`,
`businessHours.ts`). The three deploy separately and share no package.
- **Clock:** `Pacific/Auckland` wall clock (NZST/NZDT), never the server's or the device's.
- **Hours:** the `TradingHours` table (website repo owns it): one row per weekday,
  0 = Sunday, minutes past midnight, both null = closed. Days off are `DaysOff`, matched
  by Auckland calendar day.
- **Last pick-up is closing − 10 minutes**, inclusive and to the minute. A 9:30 PM close
  takes 9:20, so a late customer still lets the shop close on time. Eat-in stops at
  closing − 30.
- **ASAP** (worked out in the app) is the later of now + the quote (rounded up to the
  minute) and opening, if that is no later than the last order; otherwise the next trading
  day's opening.

`pickUpTimeCases.json` holds the rule as data, copied **byte-for-byte** into
`backend/src/lib/`, `frontend/lib/` and the website's `src/lib/`. All three suites run it.
Change the cases first, then `cmp -s` the copies.

**Here:**
- `checkPickUpTime` takes the weekly hours as an argument. Callers load them with
  `getTradingHours()` (a 60-second in-memory cache, `invalidateTradingHours()` to clear).
- There is **no fallback**: unreadable hours fail the request rather than guess.
- It answers `{ ok: false, reason, message }`. The messages name the time: "Our last pick up
  that day is 9:20 PM."
- `GET /api/getStoreHours` serves the table in the **exact shape it always has**
  (`{ Monday: ["12:30 PM", "9:30 PM"] | null, ... }`, Monday first), because installed
  app builds parse it.
- `GET /api/getStoreInfo` computes `isOpen` per request, days off included. It used to be
  computed once when the server started, so the app's "Open Now" badge showed whatever the
  shop had been at the last deploy.

**Legal documents: one file, copied, and every sentence has to be true of the code.**
`src/legal/legalDocuments.ts` holds the Terms and the Privacy Policy as data, and is copied
**byte-for-byte** into the website's `src/lib/legalDocuments.ts`. It imports nothing, so
copying it is all there is to it. `npm run verify:legal` in either repo compares the two and
exits non-zero when they differ.

- **Both platforms render the same words.** Sections that genuinely apply to one channel
  carry `appliesTo: ["app"]` or `["web"]` and are labelled in the UI — points, membership,
  offers, prizes and notifications are app-only, cookies are website-only. A second document
  is never the answer.
- **The wire shape is additive only.** Installed builds parse `{ heading, content | list }`;
  `appliesTo` is optional so an older build shows the section unlabelled rather than
  breaking. `appliesTo` is per **section**, never per list item — `list` is `string[]` on the
  wire, and an object in it renders as `[object Object]` on a build already out there.
- **The shop's details are tokens**, `{{name}}`, `{{email}}`, `{{phone}}`, `{{address}}`,
  `{{website}}`, resolved from `ShopProfile` by `resolveLegalDocument` before serving. Never
  write an address into the text; `legalDocuments.test.ts` fails if you do.
- **`legalDocuments.test.ts` holds the content to the standard the old documents failed**,
  and every case in it is a bug that shipped: a section whose whole body was "We have put in
  place appropriate security measures...", three sections numbered "8.", a terms document
  describing a delivery service that does not exist, an erasure promise no endpoint can
  keep, and a named analytics product the code does not use. Read it before editing the
  documents — it is the specification.
- **TypeScript, not JSON**, because this tsconfig does not resolve JSON imports and
  `tsc -p tsconfig.build.json` would not copy a `.json` into `dist`. And the website lists
  its copy in `.prettierignore`: that repo's Prettier adds semicolons and this one's does
  not, so `format:write` would otherwise break the copy silently.
- The documents change rarely and belong in code rather than the database, for the review,
  diff and revert a pull request gives them. Bump `LEGAL_LAST_UPDATED` when the text
  changes, and only then.

**Shop settings come from the database, and the website writes them.** The loyalty rates
(`LoyaltySetting`), the shop's details (`ShopProfile`), the launch announcements
(`Announcement`) and the membership benefits (`MembershipPlan.benefits`) were all compiled
in until `20260919000000_shop_settings_from_code`. They are edited from the website's
`/admin/settings`, which writes the rows directly — there is no `/api/internal` hop, because
unlike prize assignment nothing here has a guard only this server can apply.

- **Each reader is the `getPrepTimes` shape**: `lib/loyaltyRates`, `lib/storeInfo` and
  `lib/announcements` each cache for 60 seconds in memory, fall back to a `DEFAULT_*`
  constant holding exactly what used to be hardcoded, and **never cache a failure**.
- **In memory, not Redis, deliberately.** The writer is a different process in a different
  repo and cannot invalidate this one's Redis, so a TTL would be the only mechanism anyway.
  A change made on the website is live here within a minute — the same arrangement, and the
  same caveat, as the trading hours.
- **Announcements fall back to an empty list**, not to the old constants. Those were
  placeholder copy, and showing a customer a stale pop-up is worse than showing none. This
  is also the app's first request on a cold start (the one that trips the version gate), so
  it answers rather than failing.
- **Four wire shapes are frozen** because installed builds parse them, and the app has no
  over-the-air updates: `/api/getLoyaltyRates` is `{ rate, memberRate, modifier }` as plain
  numbers, `/api/getStoreInfo` carries the profile's fields plus a computed `isOpen`,
  `/api/getAnnouncements` is `[{ title, text1, text2?, updatedAt }]` with `updatedAt`
  parseable by `new Date()`, and `getMembershipDetails` carries `membershipBenefits:
  string[]`. `shopSettings.integration.test.ts` pins all four.
- **An announcement's `updatedAt` on the wire is the row's `publishedAt`, not its
  `updatedAt`.** The app compares it against the last announcement it showed, so writing it
  on every save would pop the modal for every customer each time a typo was fixed.
- **The legal text is not here.** `src/legal/*.ts` stays in code on purpose — see TODO.md
  item 5.

**Membership.** Stripe owns the truth; the webhook writes what it reads back from Stripe
rather than adjusting the row, so a redelivered or out-of-order event changes nothing.
`Membership.totalMonths` is the run of monthly invoices **paid in a row** on the current
subscription — the member discount is `min(plan.maxDiscount, totalMonths ×
plan.membershipDiscount)`, so a month never paid starts the customer at the first step
again. A renewal declined and then paid on a retry keeps the run. The Stripe Dashboard is
set to cancel a subscription whose retries all fail (keep it so — with "unpaid" or "past
due" a lapsed member stays `isActive`, can only retry, and `createMembership` refuses them),
and rejoining creates a new subscription counted from one.

Because event payloads are in acacia shape and SDK responses in basil (see **Stripe**
above), handlers read events defensively and re-read live state through the SDK. The
handlers:
- **`invoice.payment_succeeded`:** the renewal date is the subscription item's
  `current_period_end`. `invoice.period_end` looks back one period.
- **`invoice.payment_failed`:** only an invoice still `open` counts; a late decline must not
  put a paid member on hold. A first payment sets FAILED; a renewal sets PENDING while
  Stripe retries.
- **`customer.subscription.updated`:** records a scheduled cancellation from the live
  subscription.
- **`customer.subscription.deleted`:** sets FAILED only when `cancellation_details.reason`
  is a failed or disputed payment. An ordinary end sets SUCCESS ("nothing owed"). The enum
  has no ENDED, and PENDING would offer to retry a payment for a dead subscription.
- **Unknown subscriptions:** logged and acknowledged with 200. A throw makes Stripe
  redeliver for days.
- **First-payment race:** `createMembership` writes the subscription id only after Stripe
  has attempted the first invoice, so either outcome can arrive first. Those events claim
  the row by `subscription.metadata.userId` while it is `isActive: false, PENDING`.

`createMembership` claims the join atomically before touching Stripe: an inactive row that
is not already PENDING (or PENDING for over 2 minutes), or a fresh create (P2002 means
someone beat you). A second concurrent join gets 409. Without that, a double tap created
two subscriptions. If Stripe refuses before the subscription exists, the claim is released.

Cron (`index.ts`) all runs in `Pacific/Auckland`:
- kitchen sweep every 2 minutes;
- restaurant status every minute;
- admin socket re-check every minute;
- stranded-payment sweep every 5 minutes;
- `renewWeeklyOffers` on Monday at 00:00, the daily special, and `settleMonthlyWinners` at
  00:00 on the 1st.

### Loyalty points, the monthly leaderboard and prizes

**What it is.** Customers earn *Sweet Points* on app orders. A monthly leaderboard ranks
points **earned** in the current New Zealand calendar month. When the month ends, the top
three are recorded permanently and the shop gives each of them a prize, which they collect
in store by showing a code that staff type into the kitchen tablet. The point is a reason
to come back within the month, and a public podium that makes winning visible.

It spans four codebases: the order server owns the data and is the **only writer of
prizes**, the customer app shows the board and the prizes, the staff app hands prizes over,
and the **website's `/admin/winners`** is a second screen for assigning them and settling a
missed month — both of which it does by calling the order server, never the database.
Models: `Loyalty` (a balance), `LoyaltyRecord` (the ledger — `change` is signed, `reason`
is a free-form string, **not** an enum), `LoyaltyWinner` (one row per place per month) and
`WinnerReward` (the prize and its code).

**The lifecycle, in order**

1. **Earn** — inside `createOrder`'s transaction, so points commit or roll back with the
   order. Per line: `pointsForLine` in `lib/loyaltyRates`,
   `floor(net dollars × rate × quantity × modifier × memberRate)`. Written as
   `reason: "EARNED"`. **Website orders earn nothing** — only app orders reach the board.

   The rates are the `LoyaltySetting` row, edited from the website's `/admin/settings`
   (`rate` 6, `memberRate` 1.5 for an active membership, `modifier` 1 — the last being the
   lever for a double-points weekend). Stored as whole numbers — `memberBonusPercent` 150,
   not `1.5` — for the same reason `Offer.discountAmount` is, and divided by 100 at the
   edge so `/api/getLoyaltyRates` still serves the shape installed builds parse.
   **Resolve them before the transaction**, alongside the existing
   `Promise.all([getDaysOffKeys(), getTradingHours()])`: it holds an advisory lock on the
   payment intent until commit, and these almost always answer from a one-minute cache.
   `getLoyaltyRates` falls back to `DEFAULT_LOYALTY_RATES` and never throws, so a settings
   table that cannot be read costs nobody their points.
2. **Rank** — `GET /api/auth/getLeaderBoard`: top ten plus the viewer's own position, from
   `lib/leaderboardRanking.rankMonth` over the month from `nzMonthRange`. It filters on
   `change > 0` **and** `reason: "EARNED"`: a refunded redemption is written back as a
   *positive* `REFUND` record, and the sign alone let a cancelled order's points climb the
   board. It reads the `Loyalty` row and never upserts one — this is a GET, and it used to
   create a row just for looking.
3. **Settle** — `settleMonthlyWinners` at 00:00 NZ on the 1st: the same `rankMonth` with
   `take: 3`, written in **one** `createMany` with `skipDuplicates` against
   `@@unique([month, year, place])`. Cron runs in every process, so instances race it, and
   the loser writes nothing rather than half-settling a month. Settled once and never
   revisited — a March refund does not reopen February. It invalidates the banner cache.

   It returns an `outcome`: `RECORDED`, `ALREADY_SETTLED` (earners existed but every place
   was on file), `NO_EARNERS`, or `FAILED`. The cron ignores it and must never throw, so
   the error is still swallowed there. **A month the cron misses is lost until settled by
   hand** — the "Settle a missed month" button on the website's `/admin/winners`, which calls
   `POST /api/internal/winners/settle`, or `POST /api/admin/settleMonth` with an admin token.
   Both go through `settleCalendarMonth`, which refuses an unfinished month and answers
   `FAILED` with a **500**: it used to answer 200, so a failed backfill read as a success.
4. **Announce** — `GET /api/getLeaderboardDetails`: last month's podium for the in-app
   banner. Public, Redis-cached and sent `Cache-Control: public`, so names are redacted
   **on the server**, per winner (`lib/leaderboardDetails`). `lastMonthsWinner` is kept
   alongside `lastMonthsTopThree` because builds already installed read only the former.
5. **Assign a prize** — staff decide what each winner gets; nothing is automatic. Two
   screens, **one implementation**: `assignReward` in `prize.controller.ts`, reached by the
   staff app through `PUT /api/admin/assignWinnerReward` and by the website through
   `PUT /api/internal/winners/reward`. It mints the code, pushes `PRIZE_READY` on the first
   assign (never on an edit — a second ping reads as a second prize), and holds every guard.
   The website used to write the row itself, with its own code generator and no way to
   push, so its prizes arrived in silence.

   The one difference between the screens is the **expiry**. By default it is the end of the
   month after the one won — derived from the month, so assigning late never extends it.
   Only the internal route accepts `expiresAt`, which is the website's date picker: honoured
   on the first assign if it is still in the future, and on an edit it moves the deadline
   only when sent (into the past is how a prize is withdrawn). The staff app's route ignores
   one, so its prizes always keep the fixed deadline.
6. **Show** — `GET /api/auth/getMyPrizes`. The code is sent **only while it would be
   honoured**, so the app can never display a code the counter will refuse. Expired prizes
   drop out, collected ones stay for seven days, and a podium with no prize yet is shown
   ("your prize is being prepared") until its default expiry passes. The app renders them on
   the **Offers** page (`_components/prizeCard.tsx`, `prizeCodeModal.tsx`); the
   `PRIZE_READY` push deep-links there.
7. **Redeem** — staff app, Redeem tab. `GET /api/admin/verifyPrizeCode` reads **without
   committing**, so staff see who is standing there before anything is spent; then
   `POST /api/admin/redeemPrizeCode` claims it with a **single conditional `updateMany`**
   whose `where` repeats every precondition, so two tablets racing one code cannot both
   win and no transaction is needed. An already-collected code is never reported as
   "invalid" — read as a typo, staff retype it and hand the prize over twice.

A code is minted once and **never rotated on an edit** (the customer may be holding a
screenshot). A collected prize cannot be changed, and a winner whose account is closed
cannot be given one — `LoyaltyWinner.userId` is `SetNull` on account deletion, so the podium
row survives with nobody left to hand the prize to. Two writers assigning the same winner at
once get a 409 rather than a 500.

**Things that must stay in step**

- **The ranking lives in one place**, `lib/leaderboardRanking.rankMonth`, and both the live
  board and settlement call it. It used to be two copies of the same `groupBy`, and they
  had already drifted once — settlement filtered on the sign alone after the board had
  learned to filter on `reason`. The ordering is `_sum` desc, then `_max(createdAt)` asc (a
  tie goes to whoever got there first), then `loyaltyId` asc so it is total. Do not
  reintroduce a second copy.
- **Prize codes are minted only here**, in `backend/src/lib/prizeCode.ts`: eight characters
  from a 30-symbol alphabet with O/0, I/1/L and U removed, stored bare and upper case, shown
  `XXXX-XXXX`. The website had its own generator that had to match this one exactly —
  `looksLikePrizeCode` rejects anything else before touching the database, so a drift would
  have made every website prize unredeemable. The staff app's `lib/prizeCode.ts` mirrors
  the length and grouping only — deliberately not the alphabet, so staff can always type
  what they see and the server answers "no such code".
- **Every month boundary comes from `nzMonthRange`.** The host runs UTC; building months
  with `new Date(y, m - 1, 1)` settled the wrong month for a whole release, and a
  `getMonth()` lookup showed no winner for all of January.

**Security and privacy**

- Codes are stored readable, because the winner re-reads theirs every time they open the
  app. What protects them is that only an ADMIN request can test one, 30⁸ of entropy, and
  single-use claiming. Both code endpoints are rate limited at 30/minute and 300/day,
  **keyed on the staff account, not the IP** — every till shares one egress address — with
  their own Redis prefix so counter traffic cannot spend the sign-in budget.
- The internal routes trust the `adminId` the website sends: the service secret is the
  boundary, and the website has checked the admin's session before calling.
- Staff surfaces deliberately see real names: they have to hand a prize to a person.
- **Customer-facing names are redacted on the server, never on the device.**
  `anonymousEnabled` is the customer's own opt-out, toggled in `app/account-details.tsx`.
  The banner and the live board both withhold the name before it leaves the server —
  `getLeaderBoard` sends `firstName`/`lastName` as `null` for an opted-out customer, keeping
  the `id` (the app's "you" highlight compares it) and the flag (installed builds read
  "Anonymous" off it). The live board used to send the real name and hide it in the app, so
  it reached every signed-in phone.

### frontend/ (customer app)

Expo Router file-based routing under `app/`; `@/*` aliases the project root; NativeWind for
styling; typed routes are on. Metro runs with `inlineRequires` so heavyweight modules
(Stripe, the carousel) are not evaluated during cold start.

Two state layers, deliberately split:

- **react-query** owns server data. Every cache key lives in `services/queries.ts` so
  screens sharing data share a fetch. Two stale tiers: 30s for per-customer data, 5 min
  (`SHARED_DATA_STALE_TIME`) for shop-wide data. `subscribeAppStateFocus()` wires AppState
  into react-query's focus manager — React Native has no window focus event, so
  refetch-on-focus silently never fires without it.
  **Use `isLoading`, not `isPending`, for any query gated by `enabled`** — a disabled query
  stays pending forever and its screen sits on a spinner that never clears.
- **AuthProvider** (`store/authProvider.tsx`) holds session, user profile, membership and
  the trading calendar. Its context value and callbacks are memoised because ~21 consumers
  re-render on every provider render. `authLoading` depends only on the locally stored
  token and must never be gated behind a network call.
- **zustand** for cart (`store/cart.ts`) and loyalty points (`store/points.ts`), both
  outside React so non-component code can reach them. Sign-out must reset both — points are
  persisted to AsyncStorage, so otherwise the next account inherits them.

**API layer.** `services/apiClient.ts` exposes `apiRequest` (the normal path: token, JSON,
status → error message) and `apiFetch` (raw response plus body, for sign-in and order
creation where error handling is more than one message per status). Supplying `authMessage`
is what marks an endpoint as authenticated; a 401 from one of those — and only those —
fires the unauthorized handler AuthProvider registers to clear an expired session. Requests
time out at 15s. The auth token is cached in memory in `services/authToken.ts` with a
shared in-flight read, because every SecureStore call crosses the native bridge.

**Cart write ordering** is the subtlest part of the app. All cart writes are serialised
through one promise chain (`enqueueCartWrite`) so adds cannot race each other or a removal
— that ordering is what keeps the server's lock order safe. Quantity taps apply locally and
sync after a 500ms debounce, registered in a flush registry; checkout calls
`flushPendingQuantitySyncs()` then awaits `whenCartWritesSettle()` before re-reading the
cart, which is why the cart screen's checkout button stays live. Checkout mints its own
`Crypto.randomUUID()` idempotency key and reuses it across payment retries.

**`lib/offerHelpers.ts` mirrors the backend on purpose.** `canRedeemAudience` and
`offerUnitPriceInCents` are deliberate copies of `lib/offerAudience` and `lib/offerPricing`
on the server; if they drift, the app offers a Redeem button the server then refuses, or
shows a price it then charges differently. `getOfferState` returns *why* an offer is
unavailable, not just that it is, because a gated offer nobody has earned and one already
used up otherwise render as the same grey box. The app does **not** gate on the offer
window — the server does, and it does not send those columns.

A cart response carries a `warning` when the server removed something (a members-only item
after a membership lapsed, an offer that stopped running). Surface it; it used to be
dropped, so items vanished with nothing said.

**Toast wrapping has to be set in `toastConfig`, not at the call site.** `Toast.show`'s
`props` object reaches `BaseToast` as a nested `props` key it never reads — it takes
`text1NumberOfLines` from its own arguments, defaulting to one line. The
`props: { text1NumberOfLines: 0 }` blocks dotted through the call sites are inert; those
toasts only wrap because `app/_layout.tsx` sets it for that type.

Customers have no socket connection — realtime for them is Expo push notifications
(`services/notifications.ts`, token synced on launch and on every foreground).

**NZ time.** `lib/nzTime.ts` is the only place weekday names, calendar days and time-of-day
comparisons come from; never use the device clock or locale for trading hours.
- **It reads `Intl.DateTimeFormat` parts directly.** `formatInTimeZone` and `toZonedTime`
  build a device-local `Date`, so an Auckland time inside the device's own daylight saving
  gap comes back an hour out (2:30 AM Auckland on 8 March 2026 read as 3:30 on a phone in
  Los Angeles).
- `lib/businessHours.ts` normalises the API's lower-case day keys and pairs weekly hours
  with one-off days off in a single `TradingCalendar` value, because a day can be within
  the weekly hours and still be shut.

**Pick-up times in the app** (the rule is under **Pick-up times** in the backend section):
- **Place-order guard:** `isOutsideOrderingHours(date, calendar, lastOrderOffsetMinutes)`
  bounds a time by the last order, not closing. It used to let 9:21-9:30 PM through, for
  the server to refuse after pay.
- **Messages:** `describePickUpProblem` tells "too soon" apart from "before opening" and
  "after the last order", and `pickUpTimeAlert` words the alert, so it gives the real
  reason. When checkout has already moved the time, every alert names the new one, a
  closed day included.
- **No fallback hours:** there is no hard-coded copy of the hours. `AuthProvider` reports
  `storeHoursStatus` ("loading" | "ready" | "error"). It is **"ready" only when the hours
  and the days off both loaded** (`fetchTradingCalendar`). A missing days-off list is an
  error, not an empty list, which would have shown "Open Now" on a day off for the whole
  session. Checkout waits for "ready" and offers a retry on "error"
  (`reloadTradingCalendar`). The store screen works out "Open Now" on the device with
  `isOpenNow`.

**Hook dependencies.** `react-hooks/exhaustive-deps` is a warning, and CI fails only on
errors. Before "fixing" one, check whether the value is stable:
- **Stable, safe to list:** expo-router's `useRouter()` returns a module singleton, zustand
  store actions never change, and AuthProvider's callbacks are memoised on the token.
- **Not stable:** a plain function declared in the component body. The Menu and Rewards
  tabs deliberately leave `scrollToCategory` out, with a disable comment saying why. Listing
  it would re-run those effects on every render and keep snapping the category bar back.

### admin/ (staff app)

Expo Router with the same `@/*` alias and NativeWind conventions. `AuthProvider` wraps
everything and gates on decoded JWT `role === "ADMIN"` — for the UI only; the server
authorises on the role on record, and drops a kitchen socket within a minute of a
demotion or password reset. Order fetching and the socket
connection are started and stopped from an `authenticated`-keyed effect in
`app/_layout.tsx` — never connect the socket or fetch orders before auth is confirmed.
Order and socket state live in zustand stores (`store/order-store.ts`,
`store/socket-store.ts`), read with selectors. `services/socket-service.ts` connects to
`EXPO_PUBLIC_SERVER_URL` and de-duplicates the sync that both launch and socket-connect
request. `services/newOrders-service.ts` queues alerts behind an EventEmitter —
`resolveCurrentAlert()` dismisses the modal and releases the next.

BLE thermal printing (`services/thermal-printer.ts`, ESC/POS) has a persistent retry queue;
jobs are retried on reconnect and on launch. AsyncStorage keys: `print_queue`,
`thermal_printers`, `default_thermal_printer`, `auto_print_enabled`. New printer models may
need `PRINTER_SERVICE_UUIDS` / `PRINTER_CHARACTERISTIC_UUIDS` updated.

For permission reviews: the audio library is used only to play new-order alert tones.
`RECORD_AUDIO` is pulled in by it and is never used.

## Conventions

- **Comments explain why, and usually name the bug that motivated the code.** This is the
  house style across all three projects and it carries real information — read the comment
  before changing the code near it, and write in the same register rather than restating
  what the line does.
- Money is always integer cents (`*InCents`), and prices are GST-inclusive.
- **Responses never carry internal error detail.** Log with `console.error`, then send a
  fixed message. A serialised Prisma error names models, arguments and queries.
  - `app.ts` ends with an error handler that does the same for anything thrown outside a
    try: a 4xx keeps its status, anything else becomes "Internal server error".
  - The one pass-through is a Stripe card decline, via `lib/stripeErrors.stripeErrorMessage`.
- **Something that belongs to someone else answers exactly like something missing** (same
  status, same body), so ids can't be probed. This covers orders, order status, cards,
  setup and payment intents, and cart lines.
- One-time codes come from `lib/otp.generateOtp` (crypto `randomInt`), never `Math.random`.
- Profile field limits live in `backend/src/utils/schema.ts` (`PROFILE_FIELD_LIMITS`: names
  50, phone 20, email 254). They are mirrored as input `maxLength`s in
  `frontend/lib/profileFields.ts`; change both together.
- Commit subjects are imperative sentences describing the behaviour change, not
  conventional-commit prefixes ("Stop a quantity tap from blocking the checkout button").
  Branches use `fix/`, `perf/`, `diag/`, `feat/` prefixes and land on `main` via PR.

## Environment variables

- `backend/`: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `REDIS_URL`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ALLOWED_ORIGINS` (CORS whitelist, comma
  separated; requests with no `Origin` — the native apps — are always allowed, and a
  browser from anywhere else gets a 403), `INTERNAL_SERVICE_SECRET`, `CLOUDINARY_*`,
  `SERVER_URL`; optional `MIN_APP_BUILD_IOS` / `MIN_APP_BUILD_ANDROID` /
  `RECOMMENDED_APP_BUILD_IOS` / `RECOMMENDED_APP_BUILD_ANDROID` (see **Minimum app
  version**, unset gates nothing); plus
  `TEST_DATABASE_URL` and optional `SQL_TIMING` for development.
- `frontend/`: `EXPO_PUBLIC_URL` (API base), `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_EXPO_PROJECT_ID`, `EXPO_PUBLIC_CLOUDINARY_*`, `EXPO_PUBLIC_FILLER_IMAGE_URL`.
- `admin/`: `EXPO_PUBLIC_SERVER_URL` (API and sockets), `EXPO_PUBLIC_LOGO_URL`.
