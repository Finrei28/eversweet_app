import React from "react"
import { Modal, Text, TouchableOpacity, View } from "react-native"
import { MaterialCommunityIcons } from "@expo/vector-icons"
import { Prize } from "@/utils/types"
import { formatWeekdayDate } from "@/lib/formatters"

/**
 * Spells the code out one character at a time for a screen reader.
 *
 * Read as a word, "7K4MQ92X" is meaningless noise, and the letters that survive
 * being read aloud are exactly the ones the alphabet was chosen for. Commas
 * make the reader pause between characters instead of running them together.
 */
const spellOut = (code: string) => code.replace(/-/g, "").split("").join(", ")

/**
 * The code a winner shows at the counter.
 *
 * A modal rather than part of the card because it wants the whole screen: this
 * gets held up and read off by somebody standing on the other side of a
 * counter, often at arm's length.
 */
export const PrizeCodeModal = ({
  prize,
  visible,
  onClose,
}: {
  prize: Prize | null
  visible: boolean
  onClose: () => void
}) => {
  const reward = prize?.reward
  if (!reward?.code) return null

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-center items-center px-4">
        <View className="bg-white rounded-2xl p-6 w-full max-w-md items-center">
          <MaterialCommunityIcons
            name="medal-outline"
            size={40}
            color="#B97B53"
          />

          <Text className="text-lg font-semibold text-gray-800 mt-3 text-center">
            {reward.title}
          </Text>
          <Text className="text-sm text-gray-500 mt-1 text-center">
            Show this to our staff to collect
          </Text>

          {/* Big, spaced and high contrast: this is read off a phone held at
              arm's length, sometimes through a cracked screen. */}
          <View className="bg-secondary rounded-xl px-6 py-5 mt-5 w-full items-center">
            <Text
              className="text-3xl font-bold text-gray-900"
              style={{ letterSpacing: 4 }}
              accessibilityLabel={`Your code is ${spellOut(reward.code)}`}
            >
              {reward.code}
            </Text>
          </View>

          <Text className="text-xs text-gray-500 mt-3 text-center">
            {`Collect in store by ${formatWeekdayDate(new Date(reward.expiresAt))}`}
          </Text>

          <TouchableOpacity
            className="mt-5 bg-primary py-3 px-8 rounded-lg w-full items-center"
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text className="text-white font-medium">Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
