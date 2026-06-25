import React from "react"
import {
  Html,
  Tailwind,
  Img,
  Head,
  Body,
  Section,
  Text,
  Heading,
  Row,
  Column,
  Link,
} from "@react-email/components"
import tailwindConfig from "../tailwind.config.js"

export default function VerifyEmail({ otp }: { otp: string }) {
  return (
    <Html lang="en" className="bg-white" dir="ltr">
      <Tailwind config={tailwindConfig}>
        <Head />
        <Body className="bg-white text-gray-500 font-sans">
          <Section align="center" className="w-full">
            <Row align="center" className="w-full">
              <Column className="w-full max-w-xl mx-auto">
                {/* Header */}
                <Section className="p-4 rounded-lg">
                  <Row>
                    <Column>
                      <Img
                        src="https://res.cloudinary.com/dlqjgl6ju/image/upload/v1742296950/eversweetLogo_epxrke.jpg"
                        alt="Eversweet Logo"
                        width="300"
                        height="300"
                        className="h-auto rounded-xl object-cover mx-auto"
                      />
                      <Heading className="text-2xl font-bold text-center mt-10 mb-2 text-black">
                        Verify your email address: {otp}
                      </Heading>
                      <Text className="text-center text-lg mb-4">
                        Thank you for signing up! Please verify your email
                        address by using the code below:
                      </Text>
                      <Text className="text-center text-lg mb-4">
                        The code is valid for 15 minutes.
                      </Text>
                    </Column>
                  </Row>
                </Section>

                {/* Verification code */}
                <Section className="p-4">
                  <Text className="text-center text-3xl text-primary font-bold mb-4">
                    {otp}
                  </Text>
                  <Text className="text-center text-lg mb-4">
                    If you didn't sign up for the Eversweet App, please ignore
                    this email.
                  </Text>
                </Section>

                {/* Footer */}
                <Section className="p-4 bg-gray-100 mt-4 rounded-lg">
                  <Text className="text-center text-sm text-gray-600 mb-2">
                    &copy; {new Date().getFullYear()} Eversweet. All rights
                    reserved.
                  </Text>
                  <Text className="text-center text-sm text-gray-600 mb-2">
                    If you have any questions, feel free to contact us at our{" "}
                    <Link href="https://www.eversweet.co.nz/contact">
                      Contact page
                    </Link>
                  </Text>
                  <Text className="text-center text-sm text-gray-600 mb-2">
                    Follow us on{" "}
                    <Link href="https://www.xiaohongshu.com/user/profile/60c075500000000001007114?xsec_token=YBhdvUxZCwzRQexEmmH8ddMuPhbZ-IeZJ9IhV0I2swYIA=&xsec_source=app_share&xhsshare=CopyLink&appuid=6800ba28000000000d00a7c7&apptime=1746072948&share_id=ba4722b98a434b36957f8fb974dcc0ec">
                      Rednote
                    </Link>
                  </Text>
                  <Text className="text-center text-sm text-gray-600 mb-2">
                    You are receiving this email because you signed up for an
                    account on the Eversweet App.
                  </Text>
                </Section>
              </Column>
            </Row>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  )
}
