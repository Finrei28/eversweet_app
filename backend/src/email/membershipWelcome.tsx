import React from "react"
import {
  Html,
  Tailwind,
  Img,
  Preview,
  Head,
  Body,
  Section,
  Text,
  Heading,
  Row,
  Column,
  Hr,
} from "@react-email/components"
import tailwindConfig from "../tailwind.config.js"
import { formatCurrency } from "../lib/formatters"

export type MembershipWelcomeProps = {
  firstName: string | null
  /** What the first payment took, in cents. Left out when Stripe did not say. */
  amountPaidInCents: number | null
  /** When the membership next renews. */
  renewsOn: Date
  /** The member discount now, and how it grows - all whole percent. */
  discountPercent: number
  stepPercent: number
  maxDiscountPercent: number
  /** The plan's benefits, already resolved against the live settings. */
  benefits: string[]
  /** Whether items already in the cart were repriced with the member discount. */
  cartRepriced: boolean
}

const renewalDate = (date: Date) =>
  new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date)

/**
 * Sent once, when a membership switches on - see `recordMembershipPayment`.
 *
 * Every sentence here has to be true of the code, like the Terms: the discount figures and the
 * benefits come from the plan and the live settings, not from copy written into this file.
 * Stripe sends its own receipt, so this does not pretend to be one.
 */
export default function MembershipWelcome({
  firstName,
  amountPaidInCents,
  renewsOn,
  discountPercent,
  stepPercent,
  maxDiscountPercent,
  benefits,
  cartRepriced,
}: MembershipWelcomeProps) {
  return (
    <Html lang="en" className="bg-white" dir="ltr">
      <Preview>Welcome to Eversweet membership</Preview>
      <Tailwind config={tailwindConfig}>
        <Head />
        <Body className="mx-auto max-w-xl bg-white px-4 py-10 font-sans text-gray-600">
          <Section className="text-center">
            <Img
              src="https://res.cloudinary.com/dlqjgl6ju/image/upload/v1742296950/eversweetLogo_epxrke.jpg"
              alt="Eversweet Logo"
              width="300"
              height="300"
              className="mx-auto h-auto rounded-xl object-cover"
            />
            <Heading as="h2" className="text-2xl font-semibold text-black">
              Welcome to the membership{firstName ? `, ${firstName}` : ""}!
            </Heading>
            <Text className="text-base">
              Your Eversweet membership is now active.
              {amountPaidInCents !== null
                ? ` Your first payment of ${formatCurrency(amountPaidInCents / 100)} has gone through.`
                : ""}
            </Text>
          </Section>

          <Section className="rounded-xl bg-orange-50 p-4">
            <Heading as="h3" className="text-lg font-semibold text-orange-400">
              Your member discount
            </Heading>
            <Text className="text-base">
              You get <strong>{discountPercent}% off</strong> in the app right now.
              {discountPercent < maxDiscountPercent
                ? ` It goes up by ${stepPercent}% for each month in a row you pay for, up to ${maxDiscountPercent}%.`
                : ""}
            </Text>
            {cartRepriced && (
              <Text className="text-base">
                Anything already in your cart now has your member price.
              </Text>
            )}
          </Section>

          {benefits.length > 0 && (
            <Section className="p-4">
              <Heading as="h3" className="text-lg font-semibold text-black">
                What you get
              </Heading>
              {benefits.map((benefit) => (
                <Row key={benefit}>
                  <Column className="w-6 align-top">
                    <Text className="my-1 text-green-700">✓</Text>
                  </Column>
                  <Column>
                    <Text className="my-1 text-base">{benefit}</Text>
                  </Column>
                </Row>
              ))}
            </Section>
          )}

          <Hr />

          <Section className="p-4">
            <Text className="text-base">
              Your membership renews automatically on{" "}
              <strong>{renewalDate(renewsOn)}</strong>, and every month after
              that, on the card you chose.
            </Text>
            <Text className="text-base">
              You can cancel any time from the Membership screen in the app. You
              keep your membership until the end of the month you have paid for.
            </Text>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  )
}

MembershipWelcome.PreviewProps = {
  firstName: "Ada",
  amountPaidInCents: 999,
  renewsOn: new Date(Date.UTC(2026, 9, 25)),
  discountPercent: 5,
  stepPercent: 5,
  maxDiscountPercent: 25,
  benefits: [
    "Free weekly Mochi Series Bowl ($9.99)",
    "Stackable membership discount from 5% to 25%, up by 5% each month",
    "Earn 1.5x loyalty points",
    "Exclusive membership offers",
    "Cancel anytime",
  ],
  cartRepriced: true,
} satisfies MembershipWelcomeProps
