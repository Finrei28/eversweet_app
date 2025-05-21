"use client"

import { Ionicons } from "@expo/vector-icons"
import { Text, View } from "react-native"

type SummaryCardProps = {
  title: string
  value: string
  icon: string
  color: string
  percentChange?: number
  isLoading?: boolean
}

export function SummaryCard({
  title,
  value,
  icon,
  color,
  percentChange,
  isLoading = false,
}: SummaryCardProps) {
  return (
    <View className="bg-white p-4 rounded-xl w-[48%] mb-4 shadow-sm">
      <View className="flex-row mb-2 items-center">
        <View
          style={{ backgroundColor: `${color}15` }}
          className="w-8 h-8 rounded-full items-center justify-center mr-2"
        >
          <Ionicons name={icon as any} size={18} color={color} />
        </View>
        <Text className="text-gray-500 font-medium">{title}</Text>
      </View>

      {isLoading ? (
        <View className="h-7 w-3/4 bg-gray-200 rounded-md mt-1 animate-pulse" />
      ) : (
        <Text className="text-2xl font-bold">{value}</Text>
      )}

      {percentChange !== undefined && !isLoading && (
        <View className="flex-row items-center mt-2">
          <Ionicons
            name={percentChange >= 0 ? "arrow-up" : "arrow-down"}
            size={14}
            color={percentChange >= 0 ? "#10B981" : "#EF4444"}
          />
          <Text
            className={
              percentChange >= 0 ? "text-green-600 ml-1" : "text-red-600 ml-1"
            }
          >
            {Math.abs(percentChange)}% from yesterday
          </Text>
        </View>
      )}
    </View>
  )
}
