import React from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { MaterialCommunityIcons } from "@expo/vector-icons"
import { Prize } from "@/utils/types"
import { formatWeekdayDate } from "@/lib/formatters"

/** The logo brown, as elsewhere: darker than `primary`, so a glyph beside a
 * tinted panel still reads. */
const LOGO_BROWN = "#B97B53"

const PLACE_WORDS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
}

const placeLabel = (place: number) => PLACE_WORDS[place] ?? `${place}th`

/**
 * A month the customer finished in the top three.
 *
 * `crown` is spoken for twice over — the members badge and the leaderboard
 * podium both use it — so a prize is a medal, which also keeps first, second
 * and third looking like the same kind of thing.
 */
export const PrizeCard = React.memo(
  ({ prize, onShowCode }: { prize: Prize; onShowCode: (prize: Prize) => void }) => {
    const { reward } = prize
    const collected = reward?.redeemedAt != null

    return (
      <View
        className="bg-white rounded-xl shadow-sm p-4 mb-4 border border-primary/30"
        accessible
        accessibilityLabel={
          reward
            ? `You placed ${placeLabel(prize.place)} and won ${reward.title}.` +
              (collected ? " Already collected." : "")
            : `You placed ${placeLabel(prize.place)}. Your prize is being prepared.`
        }
      >
        <View className="flex-row items-center">
          <View className="w-12 h-12 rounded-full bg-primary/15 items-center justify-center mr-3">
            <MaterialCommunityIcons
              name={collected ? "check-circle-outline" : "medal-outline"}
              size={26}
              color={LOGO_BROWN}
            />
          </View>

          <View className="flex-1">
            <Text className="text-xs font-semibold text-primary">
              {`${placeLabel(prize.place)} place · last month`}
            </Text>
            <Text
              numberOfLines={2}
              className="text-base font-semibold text-gray-800 mt-0.5"
            >
              {reward ? reward.title : "Your prize is being prepared"}
            </Text>
          </View>
        </View>

        {reward?.description ? (
          <Text className="text-sm text-gray-500 mt-2">
            {reward.description}
          </Text>
        ) : null}

        {!reward && (
          <Text className="text-sm text-gray-500 mt-2">
            You made the top three. We&apos;ll let you know as soon as your
            prize is ready to collect.
          </Text>
        )}

        {reward && !collected && (
          <>
            <TouchableOpacity
              className="mt-4 bg-primary py-3 rounded-lg items-center"
              onPress={() => onShowCode(prize)}
              accessibilityRole="button"
            >
              <Text className="text-white font-medium">
                Show collection code
              </Text>
            </TouchableOpacity>
            <Text className="text-xs text-gray-500 mt-2 text-center">
              {`Collect in store by ${formatWeekdayDate(new Date(reward.expiresAt))}`}
            </Text>
          </>
        )}

        {collected && (
          <Text className="text-sm text-gray-500 mt-2">
            {`Collected on ${formatWeekdayDate(new Date(reward!.redeemedAt!))}. Enjoy!`}
          </Text>
        )}
      </View>
    )
  },
)

PrizeCard.displayName = "PrizeCard"
