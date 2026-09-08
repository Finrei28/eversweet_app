import { View, Platform } from "react-native"
import React from "react"
import { Tabs } from "expo-router"
import Entypo from "@expo/vector-icons/Entypo"
import Ionicons from "@expo/vector-icons/Ionicons"
import AntDesign from "@expo/vector-icons/AntDesign"
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons"

const ICON_SIZE = 22

/**
 * Soft rounded highlight behind the active tab's icon, so the selected tab
 * reads as "on" at a glance rather than relying on colour alone.
 */
function TabIcon({
  focused,
  children,
}: {
  focused: boolean
  children: React.ReactNode
}) {
  return (
    <View
      className={`items-center justify-center rounded-full ${
        focused ? "bg-primary/15" : ""
      }`}
      style={{ width: 44, height: 32 }}
    >
      {children}
    </View>
  )
}

export default function _layout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#e6aa6b",
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          height: Platform.OS === "ios" ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === "ios" ? 28 : 8,
          backgroundColor: "#ffffff",
          borderTopWidth: 0,
          elevation: 12,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowOffset: { width: 0, height: -2 },
          shadowRadius: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Entypo name="home" color={color} size={ICON_SIZE} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <MaterialCommunityIcons
                name={focused ? "bowl-mix" : "bowl-mix-outline"}
                color={color}
                size={ICON_SIZE}
              />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: "Rewards",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Ionicons
                name={focused ? "star" : "star-outline"}
                color={color}
                size={ICON_SIZE}
              />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Ionicons
                name={focused ? "receipt" : "receipt-outline"}
                color={color}
                size={ICON_SIZE}
              />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <AntDesign name="user" color={color} size={ICON_SIZE} />
            </TabIcon>
          ),
        }}
      />
    </Tabs>
  )
}
