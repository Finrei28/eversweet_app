import React from "react"
import { View, Text } from "react-native"
import { MaterialCommunityIcons } from "@expo/vector-icons"
import { OfferAudience } from "@/utils/types"

/**
 * Marks who an offer is for.
 *
 * Follows the pill recipe the app already uses for order status — rounded-full,
 * a tinted fill, a matching border, `text-xs font-medium` — but in the brand
 * caramel rather than a semantic colour, because these say "who", not "how it
 * went". Offers open to everyone get no badge: a badge on everything is just
 * noise.
 */
const STYLES = {
  MEMBERS: {
    label: "Members",
    icon: "crown-outline",
    wrapper: "bg-primary/15 border-primary/40",
    text: "text-primary",
    colour: "#e6aa6b",
  },
  // Green rather than a second warm tone: it has to read as a *different*
  // kind of offer at a glance, and this is the same green-100/300/800 recipe
  // the app already uses for its positive badges.
  NEW_USERS: {
    label: "First order",
    icon: "gift-outline",
    wrapper: "bg-green-100 border-green-300",
    text: "text-green-800",
    colour: "#15803D",
  },
} as const

export default function AudienceBadge({
  audience,
}: {
  audience: OfferAudience
}) {
  if (audience === "EVERYONE") return null

  const style = STYLES[audience]

  return (
    <View
      className={`flex-row items-center self-start px-2.5 py-1 rounded-full border ${style.wrapper}`}
    >
      <MaterialCommunityIcons
        name={style.icon}
        size={12}
        color={style.colour}
      />
      <Text className={`ml-1 text-xs font-semibold ${style.text}`}>
        {style.label}
      </Text>
    </View>
  )
}
