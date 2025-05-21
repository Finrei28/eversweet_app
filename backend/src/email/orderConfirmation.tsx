import React from "react"
import {
  formatCurrency,
  formatDate,
  getCollectionTime,
} from "../lib/formatters"
import {
  Html,
  Button,
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
import { FullOrderType } from "../types/types"

type EmailOrderConfirmationProps = {
  order: FullOrderType
}

export default function EmailOrderConfirmation({
  order,
}: EmailOrderConfirmationProps) {
  return (
    <Html>
      <Preview>Eversweet Order Confirmation</Preview>
      <Tailwind config={tailwindConfig}>
        <Head />

        <Body className="mx-auto max-w-3xl px-4 py-10 print:py-2">
          {/* Order Status Banner */}
          <Section className="rounded-xl p-4 text-center print:hidden">
            <Row>
              <Column>
                <Img
                  src={
                    "https://res.cloudinary.com/dlqjgl6ju/image/upload/v1742296950/eversweetLogo_epxrke.jpg"
                  }
                  alt={"Eversweet Logo"}
                  width="300"
                  height="300"
                  className="h-auto rounded-xl object-cover"
                />
                <Heading
                  as="h2"
                  className="text-2xl font-semibold text-green-700"
                >
                  Order Confirmed
                </Heading>
                <Text className="lg:text-green-600">
                  Thank you for your order.
                </Text>
              </Column>
            </Row>
          </Section>

          {/* Order Details Card */}

          <Section className="overflow-hidden rounded-xl border-solid bg-white lg:border-2 lg:bg-orange-50 lg:p-6">
            <Section className="rounded-xl bg-white md:p-6">
              <Row>
                <Heading as="h2">Order #{order.tempOrderId}</Heading>
                <Text className="mt-1 flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="black"
                    width="18"
                    height="18"
                    className="mr-1"
                  >
                    <path d="M3 4c0-1.1.9-2 2-2h2V0h2v2h6V0h2v2h2c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V4zm2 2v14h14V6H5zm2 4h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-8 4h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z" />
                  </svg>
                  {formatDate(order.createdAt.toISOString())}
                </Text>
              </Row>
            </Section>

            <Section className="mb-6 mt-2 w-full rounded-xl lg:p-4">
              {/* Collection Information */}
              <Row>
                <Heading
                  as="h3"
                  className="flex items-center font-semibold text-orange-400 lg:text-2xl"
                >
                  {/* <Clock className="mr-2 h-5 w-5" /> */}
                  Collection Information
                </Heading>

                <Text className="lg:text-base">
                  Estimated pick up time at{" "}
                  <strong>{getCollectionTime(order.pickUpTime)}</strong>
                </Text>

                <Text className="lg:text-base">
                  Please have your order number ready when you arrive.
                </Text>
              </Row>
            </Section>

            <Section>
              {/* Customer Details */}

              <Heading as="h3" className="mb-3 text-lg font-semibold">
                Customer Details
              </Heading>
              <Row>
                <Text className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="black"
                    width="18"
                    height="18"
                    className="mr-2"
                  >
                    <path d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 12c-4.42 0-8 2.02-8 4.5V22h16v-3.5c0-2.48-3.58-4.5-8-4.5z" />
                  </svg>
                  {order.customerFirstName} {order.customerLastName}
                </Text>

                <Text className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="black"
                    width="18"
                    height="18"
                    className="mr-2"
                  >
                    <path d="M2 4c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V4zm2 0v2l8 5 8-5V4H4zm16 4-8 5-8-5v10h16V8z" />
                  </svg>
                  {order.customerEmail}
                </Text>
                {order.customerPhoneNumber && (
                  <Text className="flex items-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="black"
                      width="18"
                      height="18"
                      className="mr-2"
                    >
                      <path d="M6.62 10.79a15.91 15.91 0 0 0 6.59 6.59l2.2-2.2c.27-.27.66-.36 1.02-.26 1.12.3 2.32.46 3.57.46.55 0 1 .45 1 1v3.5c0 .55-.45 1-1 1-10.49 0-19-8.51-19-19 0-.55.45-1 1-1H6.5c.55 0 1 .45 1 1 0 1.25.16 2.45.46 3.57.1.36.01.75-.26 1.02l-2.2 2.2z" />
                    </svg>
                    +{order.customerPhoneNumber}
                  </Text>
                )}
              </Row>
            </Section>

            <Hr />

            <Section className="rounded-xl bg-white md:p-4">
              {/* Order Items */}

              <Heading
                as="h3"
                className="mb-4 flex items-center text-lg font-semibold"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="black"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="18"
                  height="18"
                  className="mr-2"
                >
                  <path d="M6 2L3 7v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-3-5z" />
                  <path d="M3 7h18" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                Order Items
              </Heading>

              {order.desserts.map((item) => {
                const pricePerItem =
                  (item.dessert.priceInCents +
                    item.customisations.reduce((total, customisation) => {
                      return (
                        total +
                        customisation.customisation.priceInCents *
                          customisation.quantity
                      )
                    }, 0)) /
                  100
                return (
                  <Row key={item.id}>
                    <Column className="h-20 w-20 py-4 align-top">
                      {item.dessert.imagePath ? (
                        <Img
                          src={item.dessert.imagePath || "/placeholder.svg"}
                          alt={item.dessert.name}
                          width={"100%"}
                          height={"100%"}
                          className="rounded-xl object-cover"
                        />
                      ) : (
                        <Column className="flex h-full w-full items-center justify-center bg-gray-100">
                          {/* <ShoppingBag className="h-8 w-8 text-gray-400" /> */}
                        </Column>
                      )}
                    </Column>
                    <Column className="flex flex-1 flex-col px-2">
                      <Row>
                        <Heading as="h4">{item.dessert.name}</Heading>

                        {item.customisations?.map((customisation) => (
                          <Text
                            className="-mb-4 -mt-4 ml-1 text-sm text-gray-500"
                            key={customisation.id}
                          >
                            {customisation.quantity > 1
                              ? `+ ${customisation.quantity} ${customisation.customisation.name}`
                              : customisation.quantity === 1
                                ? `+ ${customisation.customisation.name}`
                                : `- ${customisation.customisation.name}`}
                          </Text>
                        ))}

                        <Text className="text-sm text-gray-500">
                          Quantity: {item.quantity}
                        </Text>
                      </Row>
                    </Column>
                    <Column align="right" className="align-bottom">
                      <Text className="">{formatCurrency(pricePerItem)}</Text>

                      <Text className="text-sm text-gray-500">
                        {formatCurrency(pricePerItem * item.quantity)}
                      </Text>
                    </Column>
                  </Row>
                )
              })}

              <Hr />

              {/* Order Summary */}

              <Row>
                <Text>GST included</Text>
              </Row>
              <Row>
                <Column className="align-bottom">
                  <Text>Total</Text>
                </Column>
                <Column align="right">
                  <Text>{formatCurrency(order.priceInCents / 100)}</Text>
                </Column>
              </Row>
            </Section>
          </Section>

          <Hr className="lg:hidden" />

          {/* Actions */}
          <Row className="flex flex-col sm:flex-row sm:justify-between">
            <Column>
              <Text>Keen for more?</Text>
            </Column>
            <Column>
              <Button
                href={`${process.env.NEXT_PUBLIC_SERVER_URL}/menu`}
                className="ml-2 flex h-9 items-center rounded-xl bg-[hsl(28,66%,70%)] px-4 py-2 text-white shadow hover:bg-secondary"
              >
                <Text className="ml-2">Have a look at our menu</Text>
              </Button>
            </Column>
          </Row>
        </Body>
      </Tailwind>
    </Html>
  )
}
