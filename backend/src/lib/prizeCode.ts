import { randomInt } from "crypto"

/**
 * The alphabet a prize code is drawn from.
 *
 * A staff member reads this off a customer's phone and types it into a tablet,
 * often across a counter in a queue, so every pair that gets confused in that
 * situation is out: O/0, I/1/L, and U (which is misheard as "you" when the code
 * is read aloud rather than shown). What is left is 30 symbols that survive a
 * cracked screen and a bad angle.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * 30^8 is about 6.6e11. The threat is not an outsider guessing — only an
 * ADMIN-authenticated request can test a code at all — so this only has to be
 * far out of reach of a rate-limited staff account, which it is by a wide
 * margin. Eight is also short enough to read out in two groups of four.
 */
export const CODE_LENGTH = 8

/**
 * Mints a prize code.
 *
 * `randomInt` and not `Math.random()`: the OTPs elsewhere in this codebase are
 * built with `Math.random()`, which is not a CSPRNG, and that is not a pattern
 * to spread. `randomInt` also rejection-samples internally, so no character is
 * likelier than another the way `% 30` over a byte would make the first two.
 */
export const generatePrizeCode = () => {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return code
}

/**
 * The canonical form of whatever a staff member typed.
 *
 * Codes are stored bare and upper case but shown grouped as XXXX-XXXX, so the
 * obvious thing to type is the separator too. Lower case, spaces and any dashes
 * all normalise away, which means the code on screen always matches the code in
 * the box however carefully it was copied.
 */
export const normalisePrizeCode = (input: string) =>
  input.replace(/[\s-]/g, "").toUpperCase()

/** How a code is shown to the customer: two groups of four. */
export const formatPrizeCode = (code: string) =>
  `${code.slice(0, 4)}-${code.slice(4)}`

/**
 * Whether a string could be a code at all, used to answer an obviously
 * malformed one without spending a database round trip on it.
 */
export const looksLikePrizeCode = (code: string) =>
  code.length === CODE_LENGTH &&
  [...code].every((character) => CODE_ALPHABET.includes(character))
