"use client"
import { View, Text, ScrollView } from "react-native"
import { useRouter } from "expo-router"
import CustomHeader from "@/_components/custom-header"

export default function PrivacyPolicy() {
  const router = useRouter()

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView className="flex-1 px-4">
        <View className="mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Privacy Policy</Text>
          <Text className="text-gray-500 mt-1">Last updated: 18 Sep, 2025</Text>
        </View>

        <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <Text className="text-lg font-medium mb-3">1. Introduction</Text>
          <Text className="text-gray-700 mb-4">
            Welcome to Eversweet. We respect your privacy and are committed to
            protecting your personal data. This privacy policy will inform you
            about how we look after your personal data when you visit our
            website or use our mobile application and tell you about your
            privacy rights and how the law protects you.
          </Text>

          <Text className="text-lg font-medium mb-3">2. Data We Collect</Text>
          <Text className="text-gray-700 mb-4">
            We may collect, use, store and transfer different kinds of personal
            data about you which we have grouped together as follows:
          </Text>
          <View className="ml-4 mb-4">
            <Text className="text-gray-700 mb-2">
              • Identity Data: includes first name, last name, email or similar
              identifier.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Contact Data: includes email address and telephone numbers.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Financial Data: includes payment card details.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Transaction Data: includes details about payments to and from
              you and other details of products you have purchased from us.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Technical Data: includes internet protocol (IP) address, your
              login data, browser type and version, time zone setting and
              location, browser plug-in types and versions, operating system and
              platform, and other technology on the devices you use to access
              our website or mobile application.
            </Text>
          </View>

          <Text className="text-lg font-medium mb-3">
            3. How We Use Your Data
          </Text>
          <Text className="text-gray-700 mb-4">
            We will only use your personal data when the law allows us to. Most
            commonly, we will use your personal data in the following
            circumstances:
          </Text>
          <View className="ml-4 mb-4">
            <Text className="text-gray-700 mb-2">
              • Where we need to perform the contract we are about to enter into
              or have entered into with you.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Where it is necessary for our legitimate interests (or those of
              a third party) and your interests and fundamental rights do not
              override those interests.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Where we need to comply with a legal obligation.
            </Text>
          </View>

          <Text className="text-lg font-medium mb-3">4. Data Security</Text>
          <Text className="text-gray-700 mb-4">
            We have put in place appropriate security measures to prevent your
            personal data from being accidentally lost, used or accessed in an
            unauthorized way, altered or disclosed. In addition, we limit access
            to your personal data to those employees, agents, contractors and
            other third parties who have a business need to know.
          </Text>

          <Text className="text-lg font-medium mb-3">5. Data Retention</Text>
          <Text className="text-gray-700 mb-4">
            We will only retain your personal data for as long as reasonably
            necessary to fulfill the purposes we collected it for, including for
            the purposes of satisfying any legal, regulatory, tax, accounting or
            reporting requirements.
          </Text>

          <Text className="text-lg font-medium mb-3">6. Your Legal Rights</Text>
          <Text className="text-gray-700 mb-4">
            Under certain circumstances, you have rights under data protection
            laws in relation to your personal data, including the right to:
          </Text>
          <View className="ml-4 mb-4">
            <Text className="text-gray-700 mb-2">
              • Request access to your personal data.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Request correction of your personal data.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Request erasure of your personal data.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Object to processing of your personal data.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Request restriction of processing your personal data.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Request transfer of your personal data.
            </Text>
            <Text className="text-gray-700 mb-2">
              • Right to withdraw consent.
            </Text>
          </View>

          <Text className="text-lg font-medium mb-3">7. Contact Us</Text>
          <Text className="text-gray-700 mb-4">
            If you have any questions about this privacy policy or our privacy
            practices, please contact us at:
          </Text>
          <View className="ml-4 mb-4">
            <Text className="text-gray-700 mb-2">
              Email: eversweet@eversweet.co.nz
            </Text>
            <Text className="text-gray-700 mb-2">
              Address: 5D/119 Meadowland Drive, Somerville
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
