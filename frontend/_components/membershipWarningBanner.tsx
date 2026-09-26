import React from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { Feather } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { useAuth } from "@/store/authProvider"
import { membershipWarning } from "@/lib/membership"
import { useMembershipDetailsQuery } from "@/services/queries"

/**
 * A member about to lose what they have built up: a renewal on hold, or a cancelled membership
 * in its last week. Taps through to the membership screen, where Retry payment and Re-subscribe
 * are.
 *
 * The pushes say the same thing, but only to someone who allowed notifications; this is for
 * everyone else, and for the member who swiped the push away. Worded by `membershipWarning`,
 * which names the discount, a perk from the plan's own list and the rest.
 *
 * Renders nothing until the membership has loaded, and never waits on `dataLoading` - the home
 * tab deliberately does not.
 */
export default function MembershipWarningBanner({
  className = "",
}: {
  className?: string
}) {
  const router = useRouter()
  const { usersMembership } = useAuth()
  // Only for someone with a membership running: nobody else is warned, so the home tab of
  // everyone else asks for nothing. The benefits name a perk, and until they arrive the
  // warning reads without one.
  const { data: membershipDetails } = useMembershipDetailsQuery({
    enabled: !!usersMembership?.isActive,
  })

  const warning = membershipWarning(
    usersMembership,
    membershipDetails?.membershipBenefits ?? [],
  )
  if (!warning) return null

  return (
    <TouchableOpacity
      onPress={() => router.push("/membership")}
      accessibilityRole="button"
      accessibilityHint="Opens your membership"
      className={`bg-white rounded-xl shadow-sm p-4 flex-row items-center border-l-4 border-primary ${className}`}
    >
      <Feather name="alert-circle" size={22} color="#9CA3AF" />
      <View className="flex-1 mx-3">
        <Text className="text-gray-700">{warning}</Text>
      </View>
      <Feather name="chevron-right" size={20} color="#9CA3AF" />
    </TouchableOpacity>
  )
}
