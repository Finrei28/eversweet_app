"use client"

import { useAuth } from "@/providers/auth-provider"
import { useOrderContext } from "@/providers/order-provider"
import { Ionicons } from "@expo/vector-icons"
import { Redirect, Tabs } from "expo-router"
import { ActivityIndicator, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const { authenticated, loading } = useAuth()

  // useEffect(() => {
  //   ScreenOrientation.lockAsync(
  //     ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT
  //   )
  // }, [])

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#e6aa6b" />
      </View>
    )
  }

  if (!authenticated) {
    return <Redirect href="/sign-in" />
  }
  const { currentOrders } = useOrderContext()

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          height: 60 + insets.bottom,
          paddingBottom: 10,
          backgroundColor: "#FFFFFF",
          borderTopWidth: 1,
          borderTopColor: "#E5E7EB",
        },
        tabBarActiveTintColor: "#6366F1",
        tabBarInactiveTintColor: "#6B7280",
        tabBarLabelStyle: {
          fontSize: 12,
          fontFamily: "Inter-Medium",
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="current-orders"
        options={{
          title: "Current Orders",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
          tabBarBadge: currentOrders.length || undefined,
          tabBarBadgeStyle: { backgroundColor: "#EF4444" },
        }}
      />
      <Tabs.Screen
        name="past-orders"
        options={{
          title: "Past Orders",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="archive-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
