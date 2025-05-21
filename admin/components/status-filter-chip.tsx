"use client"

import { Text, TouchableOpacity } from "react-native"

type StatusFilterChipProps = {
  label: string
  isSelected: boolean
  onPress: () => void
}

export function StatusFilterChip({
  label,
  isSelected,
  onPress,
}: StatusFilterChipProps) {
  return (
    <TouchableOpacity
      className={`px-4 py-2 rounded-full mr-2 ${
        isSelected ? "bg-indigo-600" : "bg-gray-100"
      }`}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        className={`font-medium ${isSelected ? "text-white" : "text-gray-800"}`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}
