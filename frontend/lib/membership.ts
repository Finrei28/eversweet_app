import { UsersMembership } from "@/utils/types"

/**
 * Whether the customer gets member benefits right now: a subscription running and paid up.
 *
 * A copy of `isPaidUpMember` in the order server's lib/memberPricing, on purpose. The server
 * decides every price and every refusal; this only stops the app from showing a member price,
 * member savings or member points the server will not give. A membership on hold - a renewal
 * declined and being retried - is still `isActive`, and every benefit pauses until the payment
 * goes through.
 *
 * `isActive` alone still means "has a subscription running", which is what decides whether
 * to offer someone the membership at all: a customer on hold should retry, not rejoin.
 */
export const isPaidUpMember = (
  membership: Pick<UsersMembership, "isActive" | "paymentStatus"> | null | undefined,
): boolean =>
  !!membership && membership.isActive && membership.paymentStatus === "SUCCESS"
