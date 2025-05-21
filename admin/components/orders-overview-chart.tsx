"use client"

import { Overview } from "@/lib/types"
import { Dimensions, Text, View } from "react-native"
import { LineChart } from "react-native-gifted-charts"

export function OrdersOverviewChart({
  data,
  isLoading,
}: {
  data: Overview
  isLoading: boolean
}) {
  // Mock data for the chart

  const screenWidth = Dimensions.get("window").width - 100 // padding

  return isLoading ? (
    <View>
      <View className="h-64 w-full bg-gray-200 rounded-md mt-1 animate-pulse" />
    </View>
  ) : (
    <View>
      <LineChart
        data={data.overview}
        width={screenWidth}
        height={220}
        color="#6366F1"
        thickness={1}
        hideDataPoints={false}
        areaChart
        startFillColor="#6366F1"
        startOpacity={0.2}
        endFillColor="#FFFFFF"
        endOpacity={0.1}
        yAxisColor="#E5E7EB"
        xAxisColor="#E5E7EB"
        xAxisLabelTextStyle={{ color: "#6B7280" }}
        yAxisTextStyle={{ color: "#6B7280" }}
        noOfSections={5}
        isAnimated
      />

      <View className="flex-row justify-between mt-4">
        <View className="items-center">
          <Text className="text-gray-500 mb-1">Today</Text>
          <Text className="text-lg font-semibold">{data.today}</Text>
        </View>

        <View className="items-center">
          <Text className="text-gray-500 mb-1">This Week</Text>
          <Text className="text-lg font-semibold">{data.week}</Text>
        </View>

        <View className="items-center">
          <Text className="text-gray-500 mb-1">This Month</Text>
          <Text className="text-lg font-semibold">{data.month}</Text>
        </View>
      </View>
    </View>
  )
}
