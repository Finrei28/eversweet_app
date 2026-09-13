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
cache stores "this user's password-change time" so a miss falls through to a *check*,
rather than storing "this token was revoked" where an eviction would silently honour a
retired token. Order idempotency is likewise belt-and-braces — Redis is the fast path, the
unique constraint on `Order.paymentIntentId` is the guarantee.

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
  paused offer repriced a cart.
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
builds. The card is charged *before* this endpoint is reached, so the controller's rule is
that a paid order is never refused: a pick-up time that has become invalid is logged loudly
and accepted, and a retry that lost a race returns the existing order rather than "cart is
empty".

**Order lifecycle to the kitchen.** `lib/orderTiming` + `lib/prepTimes` are the one place
prep durations live (item count → prep minutes → kitchen lead time → customer quote); this
used to be duplicated in three codebases that disagreed. `lib/orderRelay` schedules the
announcement, and two socket events go to `ADMIN_ROOM` and only `ADMIN_ROOM`:
`order-received` is silent and populates the Upcoming list, `new-order` is the alarm and
fires when preparation is actually due — which for a scheduled order can be hours after
payment. A two-minute cron re-sweeps as a backstop for anything a restart dropped. Socket
room membership is decided by the JWT role in `lib/socketAuth`.

Cron (`index.ts`) all runs in `Pacific/Auckland`: kitchen sweep every 2 min, restaurant
status every minute, `renewWeeklyOffers` on Monday at 00:00, daily special, and
`settleMonthlyWinners` at 00:00 on the 1st.

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
   order. Per line: `floor(net dollars × rate × quantity × memberMultiplier)`, from
   `lib/loyaltyRates` (`rate` 6, `memberRate` 1.5 for an active membership). Written as
   `reason: "EARNED"`. **Website orders earn nothing** — only app orders reach the board.
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
`lib/businessHours.ts` normalises the API's lower-case day keys and pairs weekly hours with
one-off days off in a single `TradingCalendar` value, because a day can be within the
weekly hours and still be shut.

### admin/ (staff app)

Expo Router with the same `@/*` alias and NativeWind conventions. `AuthProvider` wraps
everything and gates on decoded JWT `role === "ADMIN"`; order fetching and the socket
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
- Commit subjects are imperative sentences describing the behaviour change, not
  conventional-commit prefixes ("Stop a quantity tap from blocking the checkout button").
  Branches use `fix/`, `perf/`, `diag/`, `feat/` prefixes and land on `main` via PR.

## Environment variables

- `backend/`: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `REDIS_URL`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ALLOWED_ORIGINS` (CORS whitelist, comma
  separated), `INTERNAL_SERVICE_SECRET`, `CLOUDINARY_*`, `SERVER_URL`; plus
  `TEST_DATABASE_URL` and optional `SQL_TIMING` for development.
- `frontend/`: `EXPO_PUBLIC_URL` (API base), `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_EXPO_PROJECT_ID`, `EXPO_PUBLIC_CLOUDINARY_*`, `EXPO_PUBLIC_FILLER_IMAGE_URL`.
- `admin/`: `EXPO_PUBLIC_SERVER_URL` (API and sockets), `EXPO_PUBLIC_LOGO_URL`.
