"use client"
import { View, Text, ScrollView } from "react-native"
import { useRouter } from "expo-router"
import CustomHeader from "@/_components/custom-header"
import useFetch from "@/services/use_fetch"
import { getTermAndConditions } from "@/services/api"
import BouncingLoader from "@/_components/loader"

export default function TermsAndConditions() {
  const router = useRouter()
  const { data: termsAndConditions, loading } = useFetch(getTermAndConditions)

  if (loading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background pb-5">
      <CustomHeader />
      <ScrollView className="px-4">
        <View className="mt-6 mb-4">
          <Text className="text-2xl font-bold">
            {termsAndConditions?.title}
          </Text>
          <Text className="text-gray-500">
            Last updated: {termsAndConditions?.lastUpdated}
          </Text>
        </View>

        {termsAndConditions?.sections.map((section, index) => (
          <View key={index} className="bg-white p-4 rounded-xl mb-4">
            <Text className="text-lg font-medium mb-2">{section.heading}</Text>

            {section.content && (
              <Text className="text-gray-700 mb-2">{section.content}</Text>
            )}

            {section.list?.map((item, i) => (
              <Text key={i} className="text-gray-700 mb-1">
                • {item}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
