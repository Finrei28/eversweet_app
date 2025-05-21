"use client"

import { DashboardHeader } from "@/components/dashboard-header"
import { useAuth } from "@/providers/auth-provider"
import thermalPrinter from "@/services/thermal-printer"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

export default function Settings() {
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [autoAccept, setAutoAccept] = useState(false)
  const { authenticated, loading, signOut } = useAuth()
  const router = useRouter()
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false)
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false)
  const [defaultPrinter, setDefaultPrinter] = useState<string | null>(null)

  useEffect(() => {
    const loadSettings = async () => {
      // Load sound setting
      const soundSetting = await AsyncStorage.getItem("soundEnabled")
      setSoundEnabled(soundSetting !== "false")

      // Load auto-accept setting
      const autoAcceptSetting = await AsyncStorage.getItem("autoAccept")
      setAutoAccept(autoAcceptSetting === "true")

      // Load auto-print setting
      const autoPrintSetting = await AsyncStorage.getItem("auto_print_enabled")
      setAutoPrintEnabled(autoPrintSetting === "true")

      // Check Bluetooth status
      checkBluetoothStatus()

      // Get default printer
      const printer = await thermalPrinter.getDefaultPrinter()
      if (printer) {
        setDefaultPrinter(printer.name)
      }
    }

    loadSettings()
  }, [])

  const checkBluetoothStatus = async () => {
    try {
      const enabled = await thermalPrinter.isBluetoothEnabled()
      setBluetoothEnabled(enabled)
    } catch (error) {
      console.error("Error checking Bluetooth status:", error)
    }
  }

  const toggleSoundEnabled = async (value: boolean) => {
    setSoundEnabled(value)
    await AsyncStorage.setItem("soundEnabled", value.toString())
  }

  const toggleDarkMode = (value: boolean) => {
    // Dark mode not implemented yet
    setDarkMode(value)
    Alert.alert("Coming Soon", "Dark mode is not yet implemented.")
    setDarkMode(false)
  }

  const toggleAutoAccept = (value: boolean) => {
    setAutoAccept(value)
    if (value) {
      Alert.alert(
        "Auto-Accept Orders",
        "All incoming orders will be automatically accepted. Are you sure?",
        [
          {
            text: "No",
            onPress: () => setAutoAccept(false),
            style: "cancel",
          },
          {
            text: "Yes",
            onPress: async () =>
              await AsyncStorage.setItem("autoAccept", "true"),
          },
        ]
      )
    } else {
      AsyncStorage.setItem("autoAccept", "false")
    }
  }

  const toggleAutoPrint = async (value: boolean) => {
    setAutoPrintEnabled(value)
    await AsyncStorage.setItem("auto_print_enabled", value.toString())
  }

  const handleSignOut = async () => {
    await signOut()
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    )
  }
  if (!authenticated) {
    router.replace("/sign-in")
    return
  }

  return (
    <View className="flex-1 bg-gray-50">
      <DashboardHeader title="Settings" />

      <ScrollView className="flex-1 px-4 py-6">
        {/* Notification Settings */}
        <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
          <Text className="px-4 pt-4 pb-2 text-lg font-semibold">
            Notification Settings
          </Text>

          <View className="border-t border-gray-100">
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-row items-center">
                <View className="w-10 h-10 bg-indigo-100 rounded-full items-center justify-center mr-4">
                  <Ionicons
                    name="volume-high-outline"
                    size={20}
                    color="#6366F1"
                  />
                </View>
                <View>
                  <Text className="font-medium text-base">
                    Order Alert Sound
                  </Text>
                  <Text className="text-gray-500">
                    Play sound when new orders arrive
                  </Text>
                </View>
              </View>
              <Switch
                value={soundEnabled}
                onValueChange={toggleSoundEnabled}
                trackColor={{ false: "#D1D5DB", true: "#C7D2FE" }}
                thumbColor={soundEnabled ? "#6366F1" : "#F9FAFB"}
              />
            </View>
          </View>

          <View className="border-t border-gray-100">
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center mr-4">
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={20}
                    color="#10B981"
                  />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-base">
                    Auto-Accept Orders
                  </Text>
                  <Text className="text-gray-500">
                    Automatically accept all incoming orders
                  </Text>
                </View>
              </View>
              <Switch
                value={autoAccept}
                onValueChange={toggleAutoAccept}
                trackColor={{ false: "#D1D5DB", true: "#A7F3D0" }}
                thumbColor={autoAccept ? "#10B981" : "#F9FAFB"}
              />
            </View>
          </View>

          <View className="border-t border-gray-100">
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 bg-blue-100 rounded-full items-center justify-center mr-4">
                  <Ionicons name="print-outline" size={20} color="#3B82F6" />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-base">
                    Auto-Print Receipts
                  </Text>
                  <Text className="text-gray-500">
                    Automatically print when order is accepted
                  </Text>
                </View>
              </View>
              <Switch
                value={autoPrintEnabled}
                onValueChange={toggleAutoPrint}
                trackColor={{ false: "#D1D5DB", true: "#BFDBFE" }}
                thumbColor={autoPrintEnabled ? "#3B82F6" : "#F9FAFB"}
              />
            </View>
          </View>
        </View>

        {/* Printer Settings */}
        <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
          <Text className="px-4 pt-4 pb-2 text-lg font-semibold">
            Printer Settings
          </Text>

          <View className="border-t border-gray-100 px-4 py-4">
            <View className="flex-row items-center mb-2">
              <View className="w-10 h-10 bg-indigo-100 rounded-full items-center justify-center mr-4">
                <Ionicons name="bluetooth" size={20} color="#6366F1" />
              </View>
              <View className="flex-1">
                <Text className="font-medium text-base">Bluetooth Status</Text>
                <Text className="text-gray-500">
                  {bluetoothEnabled
                    ? "Bluetooth is enabled"
                    : "Bluetooth is disabled"}
                </Text>
              </View>
              <View
                className={`px-2 py-1 rounded-full ${
                  bluetoothEnabled ? "bg-green-100" : "bg-red-100"
                }`}
              >
                <Text
                  className={`text-xs ${
                    bluetoothEnabled ? "text-green-800" : "text-red-800"
                  }`}
                >
                  {bluetoothEnabled ? "ON" : "OFF"}
                </Text>
              </View>
            </View>

            {defaultPrinter && (
              <View className="flex-row items-center mb-4">
                <View className="w-10 h-10 bg-green-100 rounded-full items-center justify-center mr-4">
                  <Ionicons name="print" size={20} color="#10B981" />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-base">Default Printer</Text>
                  <Text className="text-gray-500">{defaultPrinter}</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              className="bg-indigo-600 py-3 rounded-lg items-center mb-2"
              onPress={() => router.push("/bluetooth-printer-setup")}
            >
              <Text className="text-white font-medium">
                Set Up Bluetooth Printer
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="border border-indigo-600 py-3 rounded-lg items-center mb-2"
              onPress={() => router.push("/printer-test")}
            >
              <Text className="text-indigo-600 font-medium">Test Printer</Text>
            </TouchableOpacity>

            {/* <TouchableOpacity onPress={() => router.push("/printer-settings")}>
              <View className="flex-row items-center justify-between py-2">
                <Text className="text-indigo-600 font-medium">
                  Advanced Printer Settings
                </Text>
                <Ionicons name="chevron-forward" size={20} color="#6366F1" />
              </View>
            </TouchableOpacity> */}
          </View>
        </View>

        {/* App Settings */}
        <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
          <Text className="px-4 pt-4 pb-2 text-lg font-semibold">
            App Settings
          </Text>

          <View className="border-t border-gray-100">
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-row items-center">
                <View className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center mr-4">
                  <Ionicons name="moon-outline" size={20} color="#6B7280" />
                </View>
                <View>
                  <Text className="font-medium text-base">Dark Mode</Text>
                  <Text className="text-gray-500">Switch to dark theme</Text>
                </View>
              </View>
              <Switch
                value={darkMode}
                onValueChange={toggleDarkMode}
                trackColor={{ false: "#D1D5DB", true: "#6B7280" }}
                thumbColor={darkMode ? "#374151" : "#F9FAFB"}
              />
            </View>
          </View>

          <TouchableOpacity
            className="border-t border-gray-100"
            onPress={handleSignOut}
          >
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-row items-center">
                <View className="w-10 h-10 bg-red-100 rounded-full items-center justify-center mr-4">
                  <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                </View>
                <View>
                  <Text className="font-medium text-base">Sign Out</Text>
                  <Text className="text-gray-500">
                    Sign out of your account
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* About */}
        <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
          <Text className="px-4 pt-4 pb-2 text-lg font-semibold">About</Text>

          <TouchableOpacity className="border-t border-gray-100">
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-row items-center">
                <View className="w-10 h-10 bg-blue-100 rounded-full items-center justify-center mr-4">
                  <Ionicons
                    name="information-circle-outline"
                    size={20}
                    color="#3B82F6"
                  />
                </View>
                <Text className="font-medium text-base">App Version</Text>
              </View>
              <Text className="text-gray-500">1.0.0</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}
