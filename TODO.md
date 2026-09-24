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

**Where it stands**

- **Card orders (checkout):** `confirmPayment` in `@stripe/stripe-react-native` runs any 3DS challenge itself, and `StripeProvider` sets `urlScheme="eversweet"` (checkout, membership, payment-methods). **Likely covered, but untested.** Recovery on returning to the foreground now waits while a checkout is running, so coming back from a bank app no longer pops a false alert.
- **Adding a card:** a SetupIntent via PaymentSheet handles 3DS.
- **Joining membership: not covered.** `createMembership` creates the subscription server-side and charges at once. If the bank demands authentication, the subscription goes `incomplete` and nothing in the app lets the customer authenticate; the join poll just times out.
- **Membership renewals: not covered.** They are off-session. Stripe raises `invoice.payment_action_required`, which the webhook doesn't handle.

**To do**

- Test on a dev build in Stripe test mode with cards that need authentication (e.g. `4000 0025 0000 3155`, `4000 0027 6000 3184`). Cover checkout, adding a card, joining membership, and backgrounding the app mid-challenge.
- **If joining fails:** return the first invoice's payment intent client secret (or create with `payment_behavior: "default_incomplete"`), and have the app confirm it with `confirmPayment`.
- **For renewals:** decide between Stripe's own authentication emails (Dashboard setting) and handling `invoice.payment_action_required` with a push notification plus an in-app screen to authenticate.

**Decide:** how far to go. NZ cards rarely challenge, but it isn't zero.

---

## 3. Warn members before they lose their discount

**Where it stands**

- The member discount is a streak: `min(plan.maxDiscount, totalMonths × plan.membershipDiscount)` (5% a month, up to 25%). Any ended subscription restarts at 5%; a renewal paid late during Stripe's retries keeps the streak.
- The cancel modal already says the discount resets if the membership expires.
- After cancelling, `ManageMembershipCard` shows "Expires on" and a Re-subscribe button, but nothing reminds the member later.
- A declined renewal (`paymentStatus: PENDING`) only shows "On Hold" / "Payment Failed" on the membership screen.

**Ideas**

- **Reminder before `endDate`:** a push N days before a membership with `cancel: true` ends, e.g. "Your 20% member discount ends on 14 Oct. Re-subscribe to keep it". A daily cron. Avoiding repeats needs either a sent-marker (a schema change, via the website repo) or a one-day `endDate` window per run.
- **Push when a renewal is declined** (the renewal branch of `invoice.payment_failed`), naming the discount at stake and linking to Retry payment.
- **In-app banner** on home or cart while `cancel` is true or the payment is pending.
- **Show the current discount** and the next step on the manage card, so the member sees what they'd lose.

**Decide:**

- How many days' notice, and whether to send one reminder or several.
- Push notifications, in-app only, or both.

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
