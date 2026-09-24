import { db } from "./db"
import { liveOfferWhere } from "./offerAvailability"
import { sendOfferNotifications } from "../controllers/notification.controller"
import { getErrorMessage } from "../utils/getError"

/**
 * Takes ownership of announcing one offer. True exactly once per offer, for whichever
 * caller gets there first.
 *
 * Its own function because that is the guarantee the whole sweep rests on, and a guarantee
 * worth testing is worth being able to call. Cron runs in every instance, so two processes
 * reach the same offer together; the `notifiedAt: null` in the WHERE is what makes the
 * update conditional, so the loser updates no rows and says so. It is the shape
 * `redeemPrizeCode` uses to stop two tablets spending one code.
 *
 * Claiming before sending means a crash in between loses that announcement. That is the
 * right way round: one nobody sends is quiet, while a duplicate is a second push to every
 * customer in the shop's database and cannot be taken back.
 */
export const claimForAnnouncement = async (
  offerId: string,
  now: Date,
): Promise<boolean> => {
  const { count } = await db.offer.updateMany({
    where: { id: offerId, notifiedAt: null },
    data: { notifiedAt: now },
  })
  return count === 1
}

/**
 * Tells customers about offers that have become available and not yet been announced.
 *
 * **Why a sweep and not a hook on the write.** There is no moment to hang this on. An offer
 * saved with a future `startsAt` becomes live at that instant with no mutation, no write and
 * nobody touching it - `isOfferLive` is a pure function of the clock. And there is no single
 * "goes live" mutation either: the website's `offerScalars` passes `isActive` straight
 * through, so `createOffer` and `updateOffer` can both take an offer live without `setActive`
 * ever being called. Announcing on create would fire days early for a scheduled offer and
 * miss one switched on by an edit. Polling liveness is the only formulation true for all of
 * them.
 *
 * **The claim comes before the push.** Cron runs in every instance, so two processes reach
 * the same offer at the same time; the conditional `updateMany` means only one of them can
 * win it, the same shape `redeemPrizeCode` uses to stop two tablets spending one code. It
 * also means a crash between claiming and sending loses that announcement. That is the right
 * way round: an announcement nobody sends is quiet, while a duplicate is a second push to
 * every customer in the shop's database and cannot be taken back.
 *
 * Never throws. It is a cron, and there is nothing to hand an error to.
 */
export const announceNewOffers = async (now: Date = new Date()): Promise<void> => {
  try {
    const due = await db.offer.findMany({
      // `notifiedAt: null` narrows the scan; it is not what makes this safe. The claim
      // below is. Without it this would read every live offer every five minutes and try
      // to claim each one.
      where: { ...liveOfferWhere(now), notifiedAt: null },
      // Listed rather than selected wholesale, so a client generated either side of an
      // unapplied migration cannot ask for a column the database lacks.
      select: { id: true, name: true, description: true, audience: true },
      orderBy: { id: "asc" },
    })

    for (const offer of due) {
      if (!(await claimForAnnouncement(offer.id, now))) continue

      const sent = await sendOfferNotifications(
        "New offer at Eversweet",
        // The offer's own description if it has one, because that is what the shop wrote to
        // describe it. Its name alone reads as an advert for nothing in particular.
        offer.description?.trim()
          ? `${offer.name} - ${offer.description.trim()}`
          : `${offer.name} is now available. Tap to take a look.`,
        offer.audience === "MEMBERS",
      )

      console.log(
        `Announced offer ${offer.id} (${offer.audience}) to ${sent} customer(s).`,
      )
    }
  } catch (error) {
    console.error("Failed to announce new offers:", getErrorMessage(error))
  }
}
