import { formatCustomisation } from "@/lib/formatters"
import { Order } from "@/lib/types"

/**
 * The docket the kitchen and the customer read, as ESC/POS text.
 *
 * Kept apart from the Bluetooth transport in `thermal-printer.ts` so the
 * layout can be tested — it is a pure string, and everything about how it
 * reads is decided here.
 */

export const ESC = "\x1B"
export const GS = "\x1D"
export const INIT = ESC + "@"
export const ALIGN_CENTER = ESC + "a" + "\x01"
export const ALIGN_LEFT = ESC + "a" + "\x00"
export const ALIGN_RIGHT = ESC + "a" + "\x02"
export const BOLD_ON = ESC + "E" + "\x01"
export const BOLD_OFF = ESC + "E" + "\x00"
export const LINE_FEED = "\x0A"
export const CUT_PAPER = GS + "V" + "\x41" + "\x03"

/**
 * Character size, as `GS ! n`: the high nibble is the width multiplier and the
 * low nibble the height, both counting from zero.
 *
 * Which nibble is used matters more than it looks. Doubling the *width* halves
 * how much fits on a line, so a wide receipt is a receipt that wraps in the
 * middle of a dessert name; doubling the *height* makes the type taller at the
 * same 32 columns. Everything on this docket that is a full line of text is
 * therefore double-height, and only the few short things worth reading from
 * arm's length — the shop, the order number, the total, the pick-up time — pay
 * the width to be genuinely big.
 */
export const SIZE_SMALL = GS + "!" + "\x00"
export const SIZE_BODY = GS + "!" + "\x01"
export const SIZE_HEADING = GS + "!" + "\x11"
export const SIZE_TITLE = GS + "!" + "\x22"

/** Printable characters per line: 58mm paper, font A, single width. */
export const COLUMNS = 32

/** The same paper once the width multiplier is doubled. */
export const WIDE_COLUMNS = 16

/**
 * Wrap to a column count, breaking on spaces.
 *
 * A word longer than the line is cut rather than allowed to run on, because
 * the printer's own wrapping loses the leading spaces that mark a
 * customisation as belonging to the dessert above it.
 */
export const wrap = (text: string, width: number): string[] => {
  const lines: string[] = []
  let line = ""

  const push = () => {
    lines.push(line)
    line = ""
  }

  for (const word of text.split(" ").filter(Boolean)) {
    if (line && line.length + 1 + word.length <= width) {
      line += " " + word
      continue
    }
    if (line) push()

    let rest = word
    while (rest.length > width) {
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    line = rest
  }

  if (line) push()
  return lines.length > 0 ? lines : [""]
}

/**
 * A label on the left and a figure on the right of one line.
 *
 * The figure is what the line exists for, so it keeps its place at the right
 * margin and the label wraps beneath itself when it is too long to share.
 */
export const row = (left: string, right: string, width = COLUMNS): string[] => {
  const lines = wrap(left, Math.max(1, width - right.length - 1))
  const last = lines.pop() ?? ""
  const gap = width - last.length - right.length

  return gap >= 1
    ? [...lines, last + " ".repeat(gap) + right]
    : [...lines, last, right.padStart(width)]
}

const rule = (char = "-", width = COLUMNS) => char.repeat(width)

const money = (cents: number) => "$" + (cents / 100).toFixed(2)

/** What one dessert costs, including whatever was added to it. */
const lineTotal = (item: Order["desserts"][number]) => {
  const customisations = item.customisations.reduce(
    (total, c) =>
      total +
      // A removal has no price; only what was added is charged.
      (c.quantity > 0
        ? (c.customisation.priceInCents - c.discountedAmountInCents) * c.quantity
        : 0),
    0,
  )

  return (
    (item.priceInCents - item.discountedAmountInCents + customisations) *
    item.quantity
  )
}

/**
 * Times are built here rather than with the app's `Intl` formatters, which
 * emit non-ASCII spaces and a Unicode minus in some locales — invisible on a
 * screen, mojibake on a docket.
 */
const pad = (value: number) => String(value).padStart(2, "0")

export const formatTimeOfDay = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return "--:--"

  const hours = date.getHours()
  const suffix = hours < 12 ? "am" : "pm"
  const twelve = hours % 12 === 0 ? 12 : hours % 12

  return `${twelve}:${pad(date.getMinutes())}${suffix}`
}

export const formatStamp = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return "--"

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${formatTimeOfDay(date)}`
}

/**
 * The receipt, as a single ESC/POS string.
 *
 * Reads top to bottom in the order it is needed: who it is from, which order
 * it is, what is in it, what it cost, and when it is collected. Held to ASCII
 * — the transport encodes as UTF-8 and these printers do not, so a smart quote
 * or a "x" typed as a multiplication sign arrives as mojibake.
 */
export const buildReceipt = (order: Order): string => {
  const out: string[] = []

  /**
   * One printed line, with any style change riding on the front of it.
   *
   * Style is never a line of its own: a bare `GS !` still ends in a feed, and
   * a receipt that switches size a dozen times would print a dozen blank
   * lines and eat a hand's width of paper per docket.
   */
  const line = (text = "", style = "") => out.push(style + text)

  const lines = (many: string[], style = "") =>
    many.forEach((text, index) => line(text, index === 0 ? style : ""))

  /** Bold is an attribute of a line, not a line of its own. */
  const bold = (text: string) => BOLD_ON + text + BOLD_OFF

  // Shop
  line(bold("EVERSWEET"), INIT + ALIGN_CENTER + SIZE_TITLE)
  line("5D/119 Meadowland Drive", SIZE_SMALL)
  line("Somerville, Auckland 2014")
  line()

  // What kind of order this is, then its number — the two things anyone
  // holding the docket is looking for, at the size they can be found at.
  line(bold(order.dineIn ? "EAT IN" : "TAKE AWAY"), SIZE_HEADING)
  line(bold("#" + order.tempOrderId), SIZE_TITLE)
  line(`${order.customerFirstName} ${order.customerLastName}`.trim(), SIZE_BODY)
  line()

  // Collection time, said in words above the time itself, so a docket read
  // from across a counter still says which time it is looking at.
  line(order.dineIn ? "Eat in at" : "Pick up at", SIZE_BODY)
  line(bold(formatTimeOfDay(new Date(order.pickUpTime))), SIZE_HEADING)
  line()

  // Items
  line(rule("="), ALIGN_LEFT + SIZE_BODY)

  order.desserts.forEach((item, index) => {
    if (index > 0) line(rule())

    lines(
      row(`${item.quantity}x ${item.dessert.name}`, money(lineTotal(item))).map(
        bold,
      ),
    )

    // Indented under the dessert they change, and worded as the screens word
    // them: "No Ice" for something left out, "+2 Taro" for something added.
    item.customisations.forEach((customisation) => {
      lines(
        wrap(formatCustomisation(customisation), COLUMNS - 3).map(
          (text) => "   " + text,
        ),
      )
    })
  })

  line(rule("="))

  // Money. The discount is shown only when there is one, so an ordinary order
  // is two lines rather than four.
  if (order.discountedAmountInCents > 0) {
    lines(row("Items", money(order.priceInCents)))
    lines(row("Discount", "-" + money(order.discountedAmountInCents)))
  }

  const total = order.priceInCents - order.discountedAmountInCents

  lines(row("TOTAL", money(total), WIDE_COLUMNS).map(bold), SIZE_HEADING)
  // GST is inside the price rather than added to it, which is why this says
  // "includes" and is not a line of arithmetic of its own.
  lines(row("Includes GST", money(order.GST)), SIZE_BODY)
  line()

  // Footer
  line(
    "Ordered " + formatStamp(new Date(order.createdAt)),
    ALIGN_CENTER + SIZE_SMALL,
  )
  line("Printed " + formatStamp(new Date()))
  line()
  line("Thank you!", SIZE_BODY)

  // Fed clear of the cutter, or the tear-off takes the last line with it.
  line("", SIZE_SMALL)
  line()
  line()

  return out.join(LINE_FEED) + CUT_PAPER
}
