import { Resend } from "resend"
import { getErrorMessage } from "../utils/getError"

/**
 * Sends one email through Resend.
 *
 * Resend's SDK reports most failures - a bad address, a rate limit - by returning `{ error }`
 * rather than throwing, so the catch below sees only network failures. The result is handed
 * back for a caller that wants to know; the callers written before that ignore it, as they
 * always have.
 */
export default async function EmailSender(
  to: string,
  subject: string,
  react: React.JSX.Element,
) {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  try {
    return await resend.emails.send({
      from: '"Eversweet" <eversweet@eversweet.co.nz>',
      to,
      subject,
      react: react,
    })
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
