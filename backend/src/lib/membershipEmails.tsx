import { db } from "./db"
import EmailSender from "./emailSender"
import MembershipWelcome from "../email/membershipWelcome"
import { loadMembershipBenefits } from "./membership"
import { memberDiscountPercent } from "./memberPricing"
import { getErrorMessage } from "../utils/getError"

/**
 * Emails a new member to say their membership is active. Nothing did before: the app showed a
 * success screen, and Stripe's receipt was the only thing that reached their inbox.
 *
 * Called once per switch-on - `recordMembershipPayment` claims the switch-on before calling
 * this, so a redelivered event sends nothing. Never throws: the membership is already active
 * when this runs, and a webhook that failed over an email would be redelivered by Stripe for
 * days - with the claim already taken, to no effect. A failure is logged and that is all.
 */
export const sendMembershipWelcome = async ({
  stripeSubscriptionId,
  amountPaidInCents,
  cartRepriced,
}: {
  stripeSubscriptionId: string
  amountPaidInCents: number | null
  cartRepriced: boolean
}): Promise<boolean> => {
  try {
    const membership = await db.membership.findUnique({
        where: { stripeSubscriptionId },
        select: {
          isActive: true,
          paymentStatus: true,
          totalMonths: true,
          endDate: true,
          plan: {
            select: {
              maxDiscount: true,
              membershipDiscount: true,
              benefits: true,
            },
          },
          user: { select: { email: true, firstName: true } },
        },
      })

    if (!membership) {
      console.error(
        `Welcome email for subscription ${stripeSubscriptionId} not sent: no membership has it.`,
      )
      return false
    }

    const result = await EmailSender(
      membership.user.email,
      "Welcome to Eversweet membership",
      MembershipWelcome({
        firstName: membership.user.firstName,
        amountPaidInCents,
        renewsOn: membership.endDate,
        discountPercent: memberDiscountPercent(membership),
        stepPercent: membership.plan.membershipDiscount,
        maxDiscountPercent: membership.plan.maxDiscount,
        // The same list, resolved the same way, as the join screen shows.
        benefits: await loadMembershipBenefits(membership.plan.benefits),
        cartRepriced,
      }),
    )

    if (result?.error) {
      console.error(
        `Welcome email for subscription ${stripeSubscriptionId} refused by Resend:`,
        result.error.message,
      )
      return false
    }
    return true
  } catch (error) {
    console.error(
      `Welcome email for subscription ${stripeSubscriptionId} failed:`,
      getErrorMessage(error),
    )
    return false
  }
}
