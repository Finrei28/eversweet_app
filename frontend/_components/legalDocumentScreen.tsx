import { View, Text, ScrollView, TouchableOpacity } from "react-native"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import { LegalDocument, LegalPlatform } from "@/utils/types"

/**
 * Renders a legal document from the server.
 *
 * `app/privacy-policy.tsx` and `app/terms-and-conditions.tsx` used to be byte-identical
 * apart from the hook they called and the variable they named, so this is both of them.
 *
 * Two things it does that they did not:
 *
 * - **Says when a section applies to only one platform.** The Terms and the Privacy Policy
 *   are now one document each, shared with the website, so a customer reading them in the
 *   app sees which parts are about the app and which are about ordering on the website.
 *   A build older than this renders the section without the label rather than breaking,
 *   which is why `appliesTo` is optional.
 * - **Says when it could not load.** A failed fetch used to leave `data` undefined, drop
 *   out of `loading`, and render a blank title above an empty scroll view - a legal page
 *   that silently showed nothing at all.
 */

const platformLabel = (appliesTo?: LegalPlatform[]): string | null => {
  if (!appliesTo || appliesTo.length === 0 || appliesTo.length === 2) return null
  return appliesTo[0] === "app" ? "In this app" : "Ordering on our website"
}

type Props = {
  document: LegalDocument | undefined
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export default function LegalDocumentScreen({
  document,
  isLoading,
  isError,
  onRetry,
}: Props) {
  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  if (isError || !document) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-lg font-medium text-center mb-2">
            We couldn&apos;t load this page
          </Text>
          <Text className="text-gray-500 text-center mb-6">
            Check your connection and try again. You can also read this document
            on our website.
          </Text>
          <TouchableOpacity
            className="bg-primary py-3 px-6 rounded-lg"
            onPress={onRetry}
          >
            <Text className="text-white font-medium">Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background pb-5">
      <CustomHeader />
      <ScrollView className="px-4">
        <View className="mt-6 mb-4">
          <Text className="text-2xl font-bold">{document.title}</Text>
          <Text className="text-gray-500">
            Last updated: {document.lastUpdated}
          </Text>
        </View>

        {document.sections.map((section, index) => {
          const label = platformLabel(section.appliesTo)

          return (
            <View key={index} className="bg-white p-4 rounded-xl mb-4">
              <Text className="text-lg font-medium mb-2">
                {section.heading}
              </Text>

              {label && (
                <View className="self-start bg-background rounded-full px-3 py-1 mb-2">
                  <Text className="text-xs font-medium text-primary">
                    {label}
                  </Text>
                </View>
              )}

              {section.content && (
                <Text className="text-gray-700 mb-2">{section.content}</Text>
              )}

              {section.list?.map((item, i) => (
                <Text key={i} className="text-gray-700 mb-1">
                  • {item}
                </Text>
              ))}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
