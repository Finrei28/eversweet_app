import { DEFAULT_PREP_TIMES, type PrepTimes } from "./prepTimes"

/**
 * When the kitchen should be told about an order, and what the customer is
 * quoted.
 *
 * An order is not news the moment it is paid for: the website lets a customer
 * pick a slot days out, and putting that on the kitchen screen at checkout
 * would bury the orders actually being made. What matters is the moment
 * preparation has to start, which these rules define.
 *
 * Everything here derives from one set of numbers — how long each size of
 * order takes to make. There used to be three copies of that rule, in the
 * website's checkout, in the kitchen sweep, and in the mobile app's quote, and
 * the third quoted customers the kitchen's start-now numbers.
 *
 * The functions stay pure and take the settings, so they can be tested without
 * a database and the hot paths can load the row once per pass.
 */

/** Minutes to actually make an order of this size. */
export const prepMinutes = (
  itemCount: number,
  times: PrepTimes = DEFAULT_PREP_TIMES,
): number => {
  if (itemCount <= 1) return times.singleItem
  if (itemCount <= 3) return times.upToThree
  if (itemCount <= 6) return times.upToSix
  return times.moreThanSix
}

/**
 * How far ahead of pick-up the kitchen is told to start.
 *
 * The preparation time plus a minute of slack, so an order placed for the
 * earliest slot the website offers is already due when it is created. With the
 * default settings this is 6 / 11 / 16 / 21 minutes — unchanged from when the
 * numbers were hardcoded.
 */
export const alertLeadMinutes = (
  itemCount: number,
  times: PrepTimes = DEFAULT_PREP_TIMES,
): number => prepMinutes(itemCount, times) + times.kitchenSlack

/**
 * The soonest a customer may be offered, in minutes from now.
 *
 * Never below `quoteFloor`, so a single dessert is still promised in ten
 * minutes even though the kitchen only needs five. The buffer absorbs a queue,
 * a busy till, or someone stepping away — under-promising costs little, and a
 * customer arriving to an unmade order costs a lot.
 */
export const quoteMinutes = (
  itemCount: number,
  times: PrepTimes = DEFAULT_PREP_TIMES,
): number => Math.max(prepMinutes(itemCount, times), times.quoteFloor)

export type TimedOrder = {
  pickUpTime: Date
  desserts: { quantity: number }[]
}

export const countItems = (desserts: { quantity: number }[]): number =>
  desserts.reduce((total, item) => total + item.quantity, 0)

/**
 * The instant an order should appear on the kitchen screen.
 *
 * Null for a pick-up time that is not a usable date. A NaN date makes every
 * comparison below it false, which reads as "not due yet" and would silently
 * withhold the order forever; a null the caller has to handle is the lesser
 * failure.
 */
export const dueAt = (
  order: TimedOrder,
  times: PrepTimes = DEFAULT_PREP_TIMES,
): Date | null => {
  const pickUp = order.pickUpTime?.getTime?.()

  if (typeof pickUp !== "number" || Number.isNaN(pickUp)) return null

  return new Date(
    pickUp - alertLeadMinutes(countItems(order.desserts), times) * 60_000,
  )
}

export const isDue = (
  order: TimedOrder,
  now: Date = new Date(),
  times: PrepTimes = DEFAULT_PREP_TIMES,
): boolean => {
  const due = dueAt(order, times)
  return due !== null && due.getTime() <= now.getTime()
}
