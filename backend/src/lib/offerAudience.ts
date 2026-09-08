import { $Enums } from "@prisma/client"
import { db } from "./db"

/**
 * A customer is "new" until their first order lands.
 *
 * An Order row is only written once payment has gone through, so the absence
 * of one is the signal — no extra bookkeeping, and eligibility closes itself
 * the moment they order rather than needing a date window swept.
 *
 * Takes a client so it can run inside the order transaction, where it must see
 * that transaction's writes.
 */
export const isNewCustomer = async (
  userId: string,
  client: { order: { count: (args: any) => Promise<number> } } = db,
): Promise<boolean> => (await client.order.count({ where: { appUserId: userId } })) === 0

/**
 * Who an offer is for. Kept in one place because three call sites have to
 * agree on it — the list the app renders, the guard on adding to a cart, and
 * the auto-unlock that runs after an order. If they disagree, an offer is
 * either advertised and then refused, or refused and then quietly redeemable.
 */
export type OfferViewer = {
  /** Paid-up member. A lapsed or failed membership is not one. */
  isActiveMember: boolean
  /** No completed order yet — see `isNewCustomer`. */
  isNewCustomer: boolean
}

export const canRedeemAudience = (
  audience: $Enums.OfferAudience,
  viewer: OfferViewer,
): boolean => {
  switch (audience) {
    case "EVERYONE":
      return true
    case "MEMBERS":
      return viewer.isActiveMember
    case "NEW_USERS":
      return viewer.isNewCustomer
  }
}

/** Why an offer was refused, phrased for the customer who tried to use it. */
export const offerRefusalMessage = (audience: $Enums.OfferAudience): string => {
  switch (audience) {
    case "MEMBERS":
      return "Join our membership to redeem this awesome offer!"
    case "NEW_USERS":
      return "This offer is for first-time customers only."
    case "EVERYONE":
      return "This offer is not available."
  }
}

/** The audiences this viewer can redeem from, as a Prisma `in` filter value. */
export const redeemableAudiences = (
  viewer: OfferViewer,
): $Enums.OfferAudience[] => {
  const audiences: $Enums.OfferAudience[] = ["EVERYONE"]
  if (viewer.isActiveMember) audiences.push("MEMBERS")
  if (viewer.isNewCustomer) audiences.push("NEW_USERS")
  return audiences
}
