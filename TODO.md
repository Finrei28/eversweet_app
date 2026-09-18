# To do

Backlog for eversweet_app. Each item covers where it stands today, the options, and what needs deciding before starting.

---

## 1. App update mechanism

**Where it stands**
- There is no way to make customers update. No `expo-updates`, and no version check. `app.json` is still `1.0.0`.
- The only lever is refusing old builds feature by feature. For example, `createPaymentIntent` answers `426 APP_UPDATE_REQUIRED` to builds that don't send `authoriseOnly: true` (hold-then-capture). Every future breaking change would need its own flag.

**Options**
- **Minimum-version gate (recommended first):** the app sends its version (`expo-application`, `nativeApplicationVersion`) as a header on every request. The server knows the minimum supported version. Below it, the app shows a blocking "Update Eversweet" screen linking to the store. Covers native changes too.
- **OTA updates (`expo-updates` / EAS Update):** push JS-only fixes without store review. Needs a `runtimeVersion` policy, and can't ship native changes.
- Probably both: OTA for quick fixes, the version gate for forcing.

**Note:** only builds that include this can ever be forced, so ship it as early as possible.

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

**Hard-coded in the backend today** (changing any of it needs a deploy):
- `backend/src/lib/loyaltyRates.ts`: points per dollar and the member multiplier. Used inside `createOrder`'s transaction.
- `backend/src/lib/membership.ts`: the `membershipBenefits` list.
- `backend/src/legal/term-and-conditions.ts` and `backend/src/legal/privacy-policy.ts`.
- `backend/src/lib/storeInfo.ts`: `storeHours` (drives `checkPickUpTime` and trading hours) and `storeInfo` (address, phone).

The website keeps its own privacy policy page and opening-hours component, so the two can already drift apart.

**There's a precedent:** `PrepTimeSetting` and `RestaurantStatus` already live in the database, edited from the website admin.

**Approach**
- **Schema change** goes through the website repo: its migrations, then mirror `schema.prisma` here and run `prisma generate` (see CLAUDE.md). Seed each table from the current constants in the migration.
- **Storage:**
  - Typed columns for rates and hours.
  - Text or JSON for the legal documents, with an effective date, so a T&C change is traceable (and the app can say "updated").
- **Reading:**
  - Go through `lib/cache` (shop-wide, long TTL, invalidated on admin edit). These are read on launch, and a database round trip from Singapore to Sydney is expensive.
  - Keep a safe default if a row is missing, the way `getPrepTimes` falls back to `DEFAULT_PREP_TIMES`. Trading hours and loyalty rates must never fail an order.
- **Editing:** a screen in the website admin (like prep times), or the admin app.
- **Sharing:** point the website at the same tables, so there is one source.

**Decide:** which of these staff actually need to change without a deploy. Rates, hours and benefits likely yes; legal text rarely.

---

## 6. The stranded-payment sweep measures its 48 hours from the wrong clock

**Where it stands**
- `refundOrderlessPayments` searches `status:'succeeded' AND <tag> AND created<now-30min AND created>now-48h`, and `created` there is the **payment intent's**, not the charge's.
- For app payments the two are the same instant: `createPaymentIntent` runs seconds before the customer confirms.
- For website payments they are not. The website creates its payment when the checkout's details are filled in, so a page left open longer than two days pays against an intent already older than the window. If the capture then succeeds and the order's commit fails, the money is taken, no order exists, and every sweep from then on excludes that payment: the customer is charged with nothing to show for it and no automatic refund.
- The hold half of the sweep is unaffected. It has no lower bound, and it already judges a hold's age by the charge (`heldLongEnoughAgo`).
- Reaching this takes a checkout open for more than 48 hours **and** the capture-to-commit gap. The customer's own retry repairs that gap first - the checkout finds the order already placed, or places it - so the sweep is the third line of defence, and the failure is logged either way.

**Do not simply widen `REFUND_WINDOW_MS`.** The window is what keeps the sweep out of history. Website payments taken without an order in the past have already been settled by hand in the shop - those orders were made and handed over - so a wider search would refund customers who got their dessert.

**Approach**
- Keep the search window as a cheap superset; it only bounds how much Stripe is asked for.
- Decide on the **charge's** `created`, which is when the money actually moved: refund only a charge between `STRANDED_AFTER_MS` and `REFUND_WINDOW_MS` old. The sweep already reads the expanded charge for `refundOf` and `heldLongEnoughAgo`, so this is a second bound beside that one.
- An old intent paid ten minutes ago is then found and refunded, while a payment genuinely taken three days ago is skipped whatever its intent's age - so a first run cannot touch anything staff settled by hand.

**Before shipping it:** check Stripe for website payments taken in the last 48 hours that have no order, as the deploy notes on Finrei28/eversweet#19 say. That is the same question this widening asks, and the answer has to be "none that staff already handled".

**Decide:** whether the extra searching is worth it at all, given how narrow the case is. Leaving it means a customer in that corner waits for staff to notice the log line.
