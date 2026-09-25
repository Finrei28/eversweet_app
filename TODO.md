# To do

Backlog for eversweet_app. Each item covers where it stands today, the options, and what needs deciding before starting.

---

## 1. App update mechanism

**Done: the minimum-version gate.** `middleware/appVersionGate` on the server, mounted
globally. The app sends `X-App-Build` and `X-App-Platform` on every request (`apiFetch` is
the only `fetch` in it); below `MIN_APP_BUILD_<IOS|ANDROID>` the server answers
`426 APP_UPDATE_REQUIRED` and the app puts up a blocking update screen, and below
`RECOMMENDED_APP_BUILD_<IOS|ANDROID>` it carries `X-App-Update-Recommended` and the app
offers a dismissible nudge once a launch. Thresholds are env vars — unset gates nothing —
so raising or rolling one back is a restart, not a deploy. See **Minimum app version** in
CLAUDE.md for the fail-open rules and for how to raise `MIN_*` safely.

It compares EAS build numbers rather than `expo.version`, because EAS increments those on
every build and nobody has to remember. `expo.version` should still be bumped on every store
submission, for the listing and for support, but the gate does not depend on it — which is
why launching at `1.0.0` costs nothing.

The note about shipping early paid off: this landed **before the customer app launched**, so
there is no install base it can never reach. Every build a customer has ever had carries the
header. A request without one still has to be waved through, since the staff app and the
website send none either — so the thing to protect is that customer builds always send it.

**Still outstanding: OTA (`expo-updates` / EAS Update).** Push JS-only fixes without store
review. Needs a `runtimeVersion` policy and changes to every build profile, and it cannot
ship native changes — so it complements the gate rather than replacing it. Worth noting
that if it is added, the gate keeps working unchanged: it reads `nativeBuildVersion`, which
describes the installed binary rather than whatever JS bundle is running on top of it.

---

## 2. 3D Secure: is more integration needed?

**Why it matters at all.** A card saved in Stripe is not exempt: the card's bank (and Radar)
decide per payment whether to ask the customer to confirm it is them. NZ has no strong
customer authentication law like the EU/UK, so challenges are rare, but the bank's own risk
rules, a tourist's EU/UK card or a Radar rule can all ask. An authenticated payment also moves
fraud-chargeback liability to the bank.

**Where it stands**

- **Card orders (checkout):** `confirmPayment` in `@stripe/stripe-react-native` runs any 3DS challenge itself, and `StripeProvider` sets `urlScheme="eversweet"` (checkout, membership, payment-methods). **Covered, untested.** Recovery on returning to the foreground waits while a checkout is running, so coming back from a bank app does not pop a false alert.
- **Adding a card:** a SetupIntent via PaymentSheet handles 3DS. **Covered, untested.**
- **Joining membership: built on 2026-09-25, untested on a device.** `createMembership` still
  creates the subscription and attempts the first invoice server-side. When that payment is
  waiting on the bank (`requires_action`), the 201 also carries `requiresAction`,
  `clientSecret` and `paymentMethodId`, and the app confirms it with `confirmPayment`. Builds
  from before ignore the extra fields and fail the join as they always did.
- **Retrying a held renewal: built on 2026-09-25, untested on a device.** `retryPayment` pays
  off-session, which a bank that wants authentication declines with `authentication_required`.
  It now answers **402 `AUTHENTICATION_REQUIRED`** with the payment's client secret, and the app
  confirms it. A 402 rather than a 200 so older builds still read a failed retry, with the same
  message.
- **The poll after confirming ignores FAILED.** Stripe can report a first payment waiting on
  the bank as `invoice.payment_failed`, so the row can read FAILED before the customer has answered;
  once `confirmPayment` has gone through that is stale. The webhook switches a FAILED row on
  when the payment arrives (pinned in `stripeWebhook.integration.test.ts`).
- **Renewals themselves** are off-session and banks rarely challenge them. If one does,
  `invoice.payment_failed` or `invoice.payment_action_required` (both handled, one push between
  them) puts the member on hold with `paymentFailureCode: "authentication_required"`. The push
  ("Please confirm your membership payment"), the home/cart banner and the manage card
  ("Confirm payment") ask them to confirm with their bank rather than say the payment failed,
  and Retry shows the bank's check. Also a backstop for a member who missed Stripe's email.
  Builds from before this word it as a failed payment, and their Retry cannot confirm.

**Still to do**

- **Switch on Stripe's hosted 3DS email** (Dashboard: Billing → Settings → Subscriptions and
  emails → "Send a Stripe-hosted link for customers to confirm their payments when required").
  No code; it covers a member who never opens the app. Leave "Enable 3D Secure" off: it only
  lets Radar rules *request* 3DS on subscription payments, which adds friction for little
  gain here.
- **Add `invoice.payment_action_required` to the webhook endpoint's events** (Dashboard:
  Developers → Webhooks). The handler is there, but Stripe only sends selected events.
- **Test on a dev build in Stripe test mode** with `4000 0025 0000 3155` (authenticates once
  when set up, then works off-session) and `4000 0027 6000 3184` (always asks):
  - checkout, adding a card, backgrounding the app mid-challenge;
  - joining, including cancelling the bank's check (the row should end FAILED, so a second
    join is not held off by the two-minute join lock);
  - a renewal on a test clock: check which events fire, then Retry from the app.

**Rollout:** the app build first, then the server. The new build behaves exactly as before
against the old server (no `requiresAction`, no 402, no `paymentFailureCode`). The server the
other way round is safe too, but its push tells a member to "confirm it in the app", which an
old build's Retry cannot do. Then add the webhook event and switch on the email.

---

## 3. Warn members before they lose their discount

**Built** on 2026-09-25. See **Members are warned before they lose the run** in CLAUDE.md.

- **A push 3 days before a cancelled membership ends** (`MEMBERSHIP_ENDING`, daily at 10:00),
  sent once per end date and claimed on the new `Membership.endWarnedFor`.
- **A push when a renewal is declined** (`MEMBERSHIP_PAYMENT_FAILED`), sent once per hold.
- **Both name more than the discount.** They give the member's built-up %, one perk taken
  from the plan's own benefit list (today the free weekly Mochi Series Bowl) and "your other
  member benefits".
- **In the app:**
  - A banner on the home tab and in the cart while a renewal is on hold, or in a cancelled
    membership's last week.
  - The discount card shows paused, ending, or the next step ("Goes up to 25% when you renew
    on …").
  - The manage card and the cancel popup name the member's own figure.
  - The membership is reloaded on returning to the foreground, so the banner clears once
    Stripe's own retry has paid.
- **The privacy policy lists both notifications.**

**Rollout, in order:**
1. Apply `20260927000000_membership_end_warning` from the website repo.
2. Deploy the order server. Its Prisma client reads `endWarnedFor`, so the column has to
   exist first.
3. Deploy the website with the legal copy. Bumping `LEGAL_LAST_UPDATED` refuses sign-ups
   still on the old text once.

The app build can ship at any point. Older builds ignore the two new push types, so a tap
just opens the app.

**Also fixed:** `frontend/lib/priceHelper.ts` used to work out the discount inline, three
times, as `(totalMonths ?? 1) × step`. That priced a member with a count of 0 at full price
while the server gave the first step. Every price helper now goes through
`memberDiscountPercent` in `lib/membership.ts`, which mirrors the server's.

---

## 4. Live order status for customers?

**Where it stands**

- Staff status changes (`updateOrderStatus`, `admin.controller.ts`) already send an Expo push for ACCEPTED, MAKING and READY (not PICKED_UP), with `data.type: "ORDER_STATUS_CHANGED"`, `orderId` and `newStatus`.
- The Orders tab (`app/(tabs)/orders.tsx`) refreshes only on focus and pull-to-refresh. A push arriving while the app is open doesn't update the list.
- `setupNotificationListeners` (`services/notifications.ts`) exists but nothing calls it.
- Customers have no socket connection, by design. A customer with notifications turned off gets no updates at all until they reopen the tab.

**Options (cheapest first)**

1. **Refresh on push:** when an `ORDER_STATUS_CHANGED` push arrives with the app open, invalidate the orders react-query key, and the list updates at once. Very small change.
2. **Poll while an order is active:** refetch the orders query every ~30s while the Orders tab is focused and an order is PENDING, ACCEPTED or MAKING. Covers customers with notifications off.
3. **Customer sockets** (a per-user room): the most "live", but a new authenticated surface and a constant connection for every customer. Probably unnecessary given 1 and 2.

**Decide:** 1 + 2 is likely enough.

---

## 5. Move hard-coded shop data into the database

**Done**, in `20260919000000_shop_settings_from_code`. Four things that needed a deploy to
change now live in the database, edited from a new **`/admin/settings`** page on the website:

| Was                                | Now                                       |
| ---------------------------------- | ----------------------------------------- |
| `backend/src/lib/loyaltyRates.ts`  | `LoyaltySetting` — one row, whole numbers |
| `backend/src/lib/membership.ts`    | `MembershipPlan.benefits`                 |
| `backend/src/lib/announcements.ts` | `Announcement` — many rows, ordered       |
| `backend/src/lib/storeInfo.ts`     | `ShopProfile` — one row                   |

(The `storeHours` half of that last line was already done, by the `TradingHours` migration on
2026-09-18. `announcements` was not in this list and should have been: it was placeholder
text — "We are just testing this announcement..." — being served to customers.)

Each module is now a cached reader in the `getPrepTimes` shape: a one-minute in-memory
cache, a `DEFAULT_*` constant holding exactly what used to be compiled in, and no caching of
a failure. **Not Redis, deliberately** — the writer is in the website repo and cannot
invalidate a cache in the order server's process, so a TTL would be the only mechanism
anyway. The order server sees a change within a minute, as it already does for the hours.

The rates are resolved **before** `createOrder`'s transaction, which holds an advisory lock
on the payment intent until it commits.

**Where it is edited, and why there.** Preparation times stay in the staff app: the kitchen
adjusts them as service speeds up or slows down. These four are on the website instead, so
they cannot be changed from the tablet on the counter.

**Two customer-facing inaccuracies fixed on the way past:**

- Members earn 1.5x, but the benefits list and `app/offers.tsx` both advertised "2x" /
  "double". The wording is corrected and now **derived** from the rate rather than typed, and
  the admin screen flags a benefit claiming a multiplier the rates do not give.
- The website's privacy policy printed `new Date()` as its "Last Updated", so it claimed to
  have been updated today, every day.

### The legal text: in code, but now one copy

Left in the database's place deliberately — a legal document wants the review, diff and
revert a pull request gives it, none of which an admin textarea has. But the two _copies_
were the problem, and that is now fixed: `backend/src/legal/legalDocuments.ts` holds both
documents, is copied byte-for-byte into the website's `src/lib/legalDocuments.ts`, and
`npm run verify:legal` in either repo fails if they stop matching.

The app and the website now render the same Terms and the same Privacy Policy. Sections
that genuinely apply to one channel — points, membership, offers, prizes and notifications
are app-only; cookies are website-only — carry a visible label instead of a second document
being written.

The documents were also rewritten against the code, because the old ones said things that
were not true. See **Legal documents** in CLAUDE.md for the rules that keeps them honest.

**The staff app's printed receipt** (`admin/services/receipt.ts`) still writes out the
address. It prints over Bluetooth to a printer that may have no network behind it, so wiring
it up means giving the app a last-known copy to print from when offline and re-checking the
line wrap on the physical printer.

### Still outstanding

- **The website checkout still names the Terms as plain text, not a link.**
  `checkout/_components/paymentSection.tsx` says, in both languages, that completing a
  purchase means agreeing to them. The page now exists at `/terms-and-conditions`, so this
  is a two-line change nobody has made yet.
- **No automated check proves the two copies match.** `verify:legal` is a local gate that
  has to be run; two repos on two CI runners with no shared checkout cannot compare files.
  Hardening it means the app repo's workflow checking out the website repo with a token.
  The same gap applies to `pickUpTimeCases.json` and `schema.prisma`, neither of which has
  even this much.
- **There is still no way for a customer to delete their account.** The Privacy Policy now
  says so plainly and describes the manual process instead of promising a button. A real
  endpoint has to unwind in order — `LoyaltyRecord` defaults to `Restrict` and blocks
  deleting anyone who has ever earned a point — and anonymise the order rows rather than
  removing them.
- **Membership refunds within 24 hours.** The Terms currently say membership payments are
  not refunded at all, because that is what the code does - `cancelMembership` only sets
  `cancel_at_period_end` and there is no refund path anywhere on the membership. The
  intended policy is a refund within 24 hours of purchase **provided no membership benefit
  has been used**, which needs: a way to tell whether a member-priced order, a member-only
  offer or a member-rate points earn has happened since they joined; a refund of the Stripe
  invoice; and cancelling the subscription immediately rather than at period end. Until
  that exists the Terms must keep saying no refunds - the one thing they must not do is
  promise it first.
- **The new-offer notification now sends.** `announceNewOffers` sweeps every five minutes
  for offers that are live and not yet announced, claims each one with a conditional update
  and pushes. It is a sweep rather than a hook on the write because an offer with a future
  `startsAt` goes live with nothing written, and neither `createOffer` nor `updateOffer` is
  the moment it becomes visible. Worth knowing if you touch it: `closeRun` clears
  `notifiedAt` so a re-run is announced again, and the migration backfilled every existing
  offer as announced so the first deploy did not push the back catalogue at everyone.
- ~~**Legal acceptance is recorded but not required.**~~ **Required** since 2026-09-24.
  `signUp` refuses a request with no version (400 `LEGAL_ACCEPTANCE_REQUIRED`, "Please update
  the Eversweet app") and one that is not the version being served (409
  `LEGAL_DOCUMENTS_UPDATED`, on which the app reloads the documents and asks again). **Rollout:
  ship the app build before deploying the server** - every build before it sends nothing, so
  from the deploy onward those builds cannot create an account until updated. Existing
  accounts are still deliberately not backfilled: stamping them with the current version would
  record an acceptance that never happened.
- The staff app's receipt, above.

## 6. Sweet points (loyalty points) will start to expire if nothing has been bought within one month

**Built** on 2026-09-25, shipped switched **off**. See **Expiry** in CLAUDE.md. Rollout, in
order: release the app build (it shows the date and routes the `POINTS_EXPIRING` push),
apply `20260925000000_points_expiry` and deploy the server, publish an announcement, then
switch it on in the website's `/admin/settings`. The first balances expire a month after
that, and the members' no-expiry benefit appears the moment it goes on.
