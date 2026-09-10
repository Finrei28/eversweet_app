/**
 * Client-side handling of a prize code as staff type it.
 *
 * The server is the authority on whether a code is real — this only shapes what
 * goes into the box, so that what staff read off a customer's phone and what
 * they type match without anyone having to think about it.
 *
 * Mirrors CODE_LENGTH and the grouping in the backend's lib/prizeCode.ts. The
 * alphabet is deliberately *not* mirrored: rejecting a character here would
 * leave staff unable to type what they can plainly see, and the server already
 * answers "no such code" for anything that is not one.
 */
export const CODE_LENGTH = 8

/**
 * Normalises and groups as XXXX-XXXX while typing.
 *
 * Separators and case are stripped rather than rejected: the code is displayed
 * grouped, so the dash is the obvious thing to type, and a keyboard that has
 * quietly lower-cased the first letter should not cost anyone a retry.
 */
export const formatAsTyped = (raw: string) => {
  const bare = raw
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, CODE_LENGTH)

  return bare.length > 4 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare
}

/** How many real characters have been entered, ignoring the grouping dash. */
export const bareLength = (formatted: string) =>
  formatted.replace(/-/g, "").length

/** Whether there is a whole code to send. */
export const isComplete = (formatted: string) =>
  bareLength(formatted) === CODE_LENGTH
