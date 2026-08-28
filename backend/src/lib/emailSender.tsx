import { Resend } from "resend"
import { getErrorMessage } from "../utils/getError"

export default async function EmailSender(
  to: string,
  subject: string,
  react: React.JSX.Element,
) {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  try {
    await resend.emails.send({
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
