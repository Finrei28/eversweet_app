"use client"

import { Text, View } from "react-native"

type StatusBadgeProps = {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getStatusProps = () => {
    switch (status) {
      case "PENDING":
        return {
          bgColor: "bg-amber-100",
          textColor: "text-amber-800",
          label: "Pending",
        }
      case "ACCEPTED":
        return {
          bgColor: "bg-blue-100",
          textColor: "text-blue-800",
          label: "Accepted",
        }
      case "MAKING":
        return {
          bgColor: "bg-indigo-100",
          textColor: "text-indigo-800",
          label: "Making",
        }
      case "READY":
        return {
          bgColor: "bg-purple-100",
          textColor: "text-purple-800",
          label: "Ready",
        }
      case "PICKED_UP":
        return {
          bgColor: "bg-green-100",
          textColor: "text-green-800",
          label: "Picked up",
        }
      case "DECLINED":
        return {
          bgColor: "bg-red-100",
          textColor: "text-red-800",
          label: "Declined",
        }
      default:
        return {
          bgColor: "bg-gray-100",
          textColor: "text-gray-800",
          label: status,
        }
    }
  }

  const { bgColor, textColor, label } = getStatusProps()

  return (
    <View className={`px-3 py-1 rounded-full ${bgColor}`}>
      <Text className={`text-xs font-medium ${textColor}`}>{label}</Text>
    </View>
  )
}
