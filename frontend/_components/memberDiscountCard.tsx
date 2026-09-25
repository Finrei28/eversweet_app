import React from "react"
import { View, Text } from "react-native"
import DancingStar from "./dancingStar"
import { UsersMembership } from "@/utils/types"
import { builtUpDiscountPercent, isPaidUpMember } from "@/lib/membership"
import { formatShortDate } from "@/lib/formatters"

/**
 * The member's stacking discount, shown as a stat rather than a sentence.
 *
 * Follows the points card on the Profile tab — coloured strip, one big number,
 * detail underneath — with a bar showing how far along the monthly climb to
 * `maxDiscount` they are.
 */
export default function MemberDiscountCard({
  usersMembership,
}: {
  usersMembership: UsersMembership
}) {
  const step = usersMembership.plan.membershipDiscount
  const max = usersMembership.plan.maxDiscount
  const current = builtUpDiscountPercent(usersMembership)
  const atMax = current >= max
  // A renewal on hold is given nothing until it is paid; the figure still shows, greyed, as
  // what the retry would keep.
  const paused = !isPaidUpMember(usersMembership)
  const endsOn = formatShortDate(usersMembership.endDate)

  // The next step, not just the rule: "what happens next" is what makes the run worth keeping,
  // and a member who has cancelled needs to hear it resets rather than grows.
  const detail = paused
    ? "Paused until your renewal is paid"
    : usersMembership.cancel
      ? current > step
        ? `Ends on ${endsOn}. Rejoining after that starts again at ${step}%`
        : `Ends on ${endsOn}`
      : atMax
        ? "You've reached the maximum discount"
        : `Goes up to ${Math.min(max, current + step)}% when you renew on ${endsOn}, and up to ${max}% after that`

  return (
    <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
      <View className="bg-primary p-4 flex-row items-center justify-between">
        <Text className="text-white text-lg font-medium">
          Your Member Discount
        </Text>
        {atMax && <DancingStar />}
      </View>

      <View className="p-6 items-center">
        <Text
          className={`font-bold text-4xl ${paused ? "text-gray-400" : "text-primary"}`}
        >
          {current}%
        </Text>
        <Text className="text-gray-500 mt-1">off every order</Text>

        <View className="w-full h-2 bg-gray-200 rounded-full mt-4 overflow-hidden">
          <View
            className={`h-full rounded-full ${paused ? "bg-gray-400" : "bg-primary"}`}
            style={{ width: `${max > 0 ? (current / max) * 100 : 0}%` }}
          />
        </View>

        <Text className="text-gray-500 text-xs mt-2 text-center">{detail}</Text>
      </View>
    </View>
  )
}
