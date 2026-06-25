import { Resend } from "resend"

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
    if ((error as Error).message.includes("limit")) {
      throw new Error(
        "We've reached our email limit. Please try again tomorrow.",
      )
    }

    if ((error as Error).message.includes("domain")) {
      throw new Error("Email service is not configured correctly.")
    }

    throw new Error("Error sending email: " + (error as Error).message)
  }
}
