import { useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Feather } from "@expo/vector-icons"

import { openStore } from "@/lib/storeLinks"
import { apiFetch } from "@/services/apiClient"

/**
 * The wall shown to a build the server has retired.
 *
 * Rendered in place of the router's Stack, not over it, so nothing behind it
 * keeps running — and as a component rather than a route, which keeps it out of
 * the typed-route union, out of reach of a deep link, and un-escapable with the
 * back gesture.
 *
 * Its wording lives here rather than coming from the response. The same code is
 * sent by `createPaymentIntent`, whose message is about paying by card — true
 * where it is used, wrong across a full screen.
 */
export default function UpdateRequiredScreen() {
  const [checking, setChecking] = useState(false)

  /**
   * The only way out of this screen inside a session.
   *
   * A minimum set too high is undone by an environment change and a restart,
   * but nothing in the app is fetching by then to notice. One cheap public
   * request is enough: apiFetch records what the server says about this build,
   * and the wall comes down on its own if the answer has changed. It inherits
   * the 15s timeout, so it cannot sit here spinning.
   */
  const recheck = async () => {
    setChecking(true)
    try {
      await apiFetch("/api/getStoreInfo")
    } catch {
      // Whether the request failed or merely came back refused again, the
      // screen is already saying the right thing.
    } finally {
      setChecking(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center px-6">
        <Feather name="download" size={64} color="#D1D5DB" />

        <Text className="mt-4 text-xl font-bold text-center text-gray-700">
          Time to update Eversweet
        </Text>
        <Text className="mt-2 text-center text-gray-500">
          This version is no longer supported. Update to the latest version to
          keep ordering.
        </Text>

        <TouchableOpacity
          onPress={() => void openStore()}
          className="mt-6 bg-primary py-3 px-6 rounded-lg"
        >
          <Text className="text-white font-semibold">Update now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => void recheck()}
          disabled={checking}
          className="mt-4 py-3 px-6"
        >
          <Text className="text-gray-500">
            {checking ? "Checking…" : "I've already updated"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}
