import React from "react"
import { View, Text } from "react-native"
import DancingStar from "./dancingStar"
import { UsersMembership } from "@/utils/types"

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
  const current = Math.min(max, usersMembership.totalMonths * step)
  const atMax = current >= max

  return (
    <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
      <View className="bg-primary p-4 flex-row items-center justify-between">
        <Text className="text-white text-lg font-medium">
          Your Member Discount
        </Text>
        {atMax && <DancingStar />}
      </View>

      <View className="p-6 items-center">
        <Text className="font-bold text-4xl text-primary">{current}%</Text>
        <Text className="text-gray-500 mt-1">off every order</Text>

        <View className="w-full h-2 bg-gray-200 rounded-full mt-4 overflow-hidden">
          <View
            className="h-full bg-primary rounded-full"
            style={{ width: `${max > 0 ? (current / max) * 100 : 0}%` }}
          />
        </View>

        <Text className="text-gray-500 text-xs mt-2 text-center">
          {atMax
            ? "You've reached the maximum discount"
            : `Grows ${step}% each month, up to ${max}%`}
        </Text>
      </View>
    </View>
  )
}
