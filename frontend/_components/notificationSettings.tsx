"use client"

import { useState, useEffect } from "react"
import { View, Text, Switch, TouchableOpacity, Alert } from "react-native"
import { Feather } from "@expo/vector-icons"
import * as Notifications from "expo-notifications"
import { registerForPushNotificationsAsync } from "@/services/notifications"
import * as Linking from "expo-linking"

export default function NotificationSettings() {
  const [orderUpdatesEnabled, setOrderUpdatesEnabled] = useState(true)
  const [promotionsEnabled, setPromotionsEnabled] = useState(true)
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null)

  useEffect(() => {
    checkPermissionStatus()
  }, [])

  const checkPermissionStatus = async () => {
    const { status } = await Notifications.getPermissionsAsync()
    setPermissionStatus(status)
  }

  const requestPermissions = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync()
      setPermissionStatus(status)

      if (status === "granted") {
        const token = await registerForPushNotificationsAsync()
        if (token) {
          Alert.alert("Success", "Notifications enabled successfully!")
        }
      } else {
        Alert.alert(
          "Permission Required",
          "To receive notifications, please enable them in your device settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings(),
            },
          ]
        )
      }
    } catch (error) {
      console.error("Error requesting notification permissions:", error)
      Alert.alert("Error", "Failed to enable notifications. Please try again.")
    }
  }

  return (
    <View className="flex-1 bg-gray-50">
      <View className="mb-5">
        <Text className="text-xl font-bold">Notification Settings</Text>
      </View>

      {permissionStatus !== "granted" ? (
        <View className="items-center justify-center p-5 bg-white rounded-xl mb-5">
          <Feather name="bell-off" size={48} color="#D1D5DB" />
          <Text className="text-base text-center text-gray-500 mt-3 mb-5">
            Notifications are currently disabled
          </Text>
          <TouchableOpacity
            className="bg-emerald-500 py-3 px-5 rounded-md"
            onPress={requestPermissions}
          >
            <Text className="text-white font-semibold">
              Enable Notifications
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View className="flex-row justify-between items-center py-4 px-5 bg-white rounded-xl mb-3">
            <View className="flex-1">
              <Text className="text-base font-medium mb-1">Order Updates</Text>
              <Text className="text-sm text-gray-500 w-4/5">
                Get notified when your order status changes
              </Text>
            </View>
            <Switch
              value={orderUpdatesEnabled}
              onValueChange={setOrderUpdatesEnabled}
              trackColor={{ false: "#D1D5DB", true: "#10B981" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View className="flex-row justify-between items-center py-4 px-5 bg-white rounded-xl mb-3">
            <View className="flex-1">
              <Text className="text-base font-medium mb-1">
                Promotions & Offers
              </Text>
              <Text className="text-sm text-gray-500 w-4/5">
                Receive special offers and promotions
              </Text>
            </View>
            <Switch
              value={promotionsEnabled}
              onValueChange={setPromotionsEnabled}
              trackColor={{ false: "#D1D5DB", true: "#10B981" }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View className="flex-row items-start p-4 bg-gray-100 rounded-md mt-3">
            <Feather name="info" size={16} color="#6B7280" />
            <Text className="text-sm text-gray-500 ml-2 flex-1">
              You can change these settings at any time. You'll always receive
              important account notifications.
            </Text>
          </View>
        </View>
      )}
    </View>
  )
}
