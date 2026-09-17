import { toWeeklyHours, type TradingHoursRow } from "../lib/tradingHours"

/**
 * The hours the `20260918000000_trading_hours` migration seeds, for tests. `resetDatabase`
 * truncates `TradingHours` along with everything else, so it puts these back - a test
 * database should look like a freshly migrated one, where the shop has its hours.
 */
export const SHOP_HOURS_ROWS: TradingHoursRow[] = [
  { weekday: 0, opensAt: 720, closesAt: 1320 }, // Sunday    12:00 PM - 10:00 PM
  { weekday: 1, opensAt: 750, closesAt: 1290 }, // Monday    12:30 PM -  9:30 PM
  { weekday: 2, opensAt: 750, closesAt: 1290 }, // Tuesday
  { weekday: 3, opensAt: 750, closesAt: 1290 }, // Wednesday
  { weekday: 4, opensAt: 750, closesAt: 1290 }, // Thursday
  { weekday: 5, opensAt: 720, closesAt: 1320 }, // Friday    12:00 PM - 10:00 PM
  { weekday: 6, opensAt: 720, closesAt: 1320 }, // Saturday
]

export const SHOP_HOURS = toWeeklyHours(SHOP_HOURS_ROWS)
