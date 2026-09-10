const Currency_Formatter = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 2,
})

export function formatCurrency(amount: number) {
  return Currency_Formatter.format(amount)
}

const Number_Formatter = new Intl.NumberFormat("en-NZ")

export function formatNumber(amount: number) {
  return Number_Formatter.format(amount)
}

/**
 * Built once, like the currency formatters above.
 *
 * `Intl.DateTimeFormat` is expensive to construct — it crosses into ICU — and
 * these are called once per row of every order list, so building one per call
 * was the bulk of the cost of rendering those lists. The tradeoff is that the
 * locale and timezone are fixed at module load rather than read per call,
 * which is the same bargain `Currency_Formatter` already makes.
 */
const Date_Formatter = new Intl.DateTimeFormat("en-NZ", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
})

const Time_Formatter = new Intl.DateTimeFormat("en-NZ", {
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
})

const Collection_Time_Formatter = new Intl.DateTimeFormat("en-NZ", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
})

const Weekday_Time_Formatter = new Intl.DateTimeFormat("en-NZ", {
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
})

export const formatDate = (dateString: string) => {
  return Date_Formatter.format(new Date(dateString))
}

export const formatTime = (date: Date) => {
  return Time_Formatter.format(date)
}

export const getCollectionTime = (date: Date) => {
  return Collection_Time_Formatter.format(date)
}

export const getEarnablePoints = (total: number) => {
  return Math.round(((total / 5) * 5) / 5)
}

/**
 * How long an order counts down in seconds rather than whole minutes.
 *
 * Ten minutes out is roughly where the number stops being something to plan
 * around and starts being something to watch, and it is also what keeps the
 * per-second tick rare — see `useCountdown`.
 */
export const SECONDS_WINDOW = 10 * 60

/**
 * How long until the kitchen should start an order, for the Upcoming list.
 *
 * Inside the last ten minutes it counts down in mm:ss, so the run-up to an
 * order being due reads as a clock running out rather than a number sitting
 * still. Further out the seconds are noise and it falls back to whole minutes,
 * then to hours.
 *
 * Rounds up, so an order half a second away reads "00:01" rather than "00:00".
 * Anything already due reads as due — the alarm is what says to begin, and a
 * countdown sitting at zero would only look broken.
 */
export const formatStartsIn = (
  dueAt: string | null | undefined,
  now: Date = new Date(),
): string => {
  if (!dueAt) return "Start time unknown"

  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return "Start time unknown"

  const seconds = Math.ceil((due - now.getTime()) / 1000)

  if (seconds <= 0) return "Start now"

  if (seconds < SECONDS_WINDOW) {
    const mm = Math.floor(seconds / 60)
    const ss = seconds % 60
    return `Starts in ${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
  }

  // Derived after the mm:ss branch rather than before it, so the last second
  // of the hour reads "1 hr" instead of "60 min".
  const minutes = Math.ceil(seconds / 60)

  if (minutes < 60) return `Starts in ${minutes} min`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (hours < 24) {
    return rest === 0
      ? `Starts in ${hours} hr`
      : `Starts in ${hours} hr ${rest} min`
  }

  // Beyond a day the exact minute is noise; the pick-up time on the card is
  // the useful number.
  return `Starts ${Weekday_Time_Formatter.format(new Date(due))}`
}

/** One line of an order's customisations, as the server sends it. */
type OrderCustomisation = {
  quantity: number
  customisation: { name: string }
}

/**
 * Whether the customer asked for this ingredient to be left out.
 *
 * Customisations are ingredients, and a row only exists on an order when the
 * customer changed something: a quantity of zero means take out the one that
 * normally comes with the dessert, anything above means that many extra on
 * top. Reading those two the wrong way round is a remade order, so the test
 * lives here rather than being written out at each place that shows them.
 */
export const isRemoval = (line: OrderCustomisation) => line.quantity === 0

/**
 * A customisation as the kitchen should read it — "No Ice", "+2 Taro".
 *
 * Spelled out rather than signed with a bare "-" or "+", which are a glance
 * apart from each other on a printed docket and easy to miss entirely on a
 * screen being read across a counter.
 */
export const formatCustomisation = (line: OrderCustomisation) =>
  isRemoval(line)
    ? `No ${line.customisation.name}`
    : `+${line.quantity} ${line.customisation.name}`

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/**
 * A leaderboard month, e.g. "August 2026".
 *
 * `month` is 1-indexed because that is how the server stores it — the same
 * convention that, read as 0-indexed, once made the admin dashboard show no
 * winner for the whole of January.
 */
export const formatLeaderboardMonth = (month: number, year: number) =>
  `${MONTH_NAMES[month - 1] ?? "Unknown"} ${year}`

/** "1st", "2nd", "3rd" — the podium only ever goes to three. */
export const formatPlace = (place: number) =>
  place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`
