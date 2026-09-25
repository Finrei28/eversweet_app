import { Resend } from "resend"
import { getErrorMessage } from "../utils/getError"

/**
 * Sends one email through Resend.
 *
 * Resend's SDK reports most failures - a bad address, a rate limit, a sending domain gone
 * unverified - by returning `{ error }` rather than throwing, so the catch below sees only
 * network failures. Nothing looked at the returned error, so every one of those failures was
 * silent: a customer never got their code or their receipt, and nothing said why.
 *
 * It is logged here now, for every caller. It is still not thrown: resending a verification
 * code answers the same whatever the address, so it cannot be used to learn which are
 * registered, and failing sign-up after the account exists would only strand the customer.
 * The result is handed back for a caller that wants to act on it.
 */
export default async function EmailSender(
  to: string,
  subject: string,
  react: React.JSX.Element,
) {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  try {
    const result = await resend.emails.send({
      from: '"Eversweet" <eversweet@eversweet.co.nz>',
      to,
      subject,
      react: react,
    })
    // The subject names the kind of email; the recipient is never logged.
    if (result.error) {
      console.error(
        `Resend refused "${subject}": ${result.error.name}: ${result.error.message}`,
      )
    }
    return result
  } catch (error) {
    if (getErrorMessage(error).includes("limit")) {
      throw new Error(
        "We've reached our email limit. Please try again tomorrow.",
      )
    }

    if (getErrorMessage(error).includes("domain")) {
      throw new Error("Email service is not configured correctly.")
    }

    throw new Error("Error sending email: " + getErrorMessage(error))
  }
}
