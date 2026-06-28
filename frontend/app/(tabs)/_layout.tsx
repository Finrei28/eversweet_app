import { Image } from "react-native"
import React, { useEffect } from "react"
import { Tabs } from "expo-router"
import Entypo from "@expo/vector-icons/Entypo"
import Ionicons from "@expo/vector-icons/Ionicons"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import AntDesign from "@expo/vector-icons/AntDesign"
import { useAuth } from "@/store/authProvider"

export default function _layout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarActiveTintColor: "#e6aa6b", // active color
          tabBarInactiveTintColor: "#999999", // optional: inactive color
          tabBarIcon: ({ color, size }) => (
            <Entypo name="home" color={color} size={size ?? 24} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          headerShown: false,
          tabBarActiveTintColor: "#e6aa6b", // active color
          tabBarInactiveTintColor: "#999999", // optional: inactive color
          tabBarIcon: ({ size, focused }) => (
            <Image
              source={require("../../assets/images/eversweet_bowl_1024.png")}
              style={{
                width: size ?? 24,
                height: size ?? 24,
                tintColor: !focused ? "#999999" : "",
              }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: "Rewards",
          headerShown: false,
          tabBarActiveTintColor: "#e6aa6b", // active color
          tabBarInactiveTintColor: "#999999", // optional: inactive color
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="star" color={color} size={size ?? 24} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          headerShown: false,
          tabBarActiveTintColor: "#e6aa6b", // active color
          tabBarInactiveTintColor: "#999999", // optional: inactive color
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt" color={color} size={size ?? 24} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          headerShown: false,
          tabBarActiveTintColor: "#e6aa6b", // active color
          tabBarInactiveTintColor: "#999999", // optional: inactive color
          tabBarIcon: ({ color, size }) => (
            <AntDesign name="user" color={color} size={size ?? 24} />
          ),
        }}
      />
    </Tabs>
  )
}
