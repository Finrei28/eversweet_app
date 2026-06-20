"use client"
import { AuthProvider, useAuth } from "@/providers/auth-provider"
import { OrderProvider } from "@/providers/order-provider"
import { SocketProvider } from "@/providers/socket-provider"
import { ThemeProvider } from "@/providers/theme-provider"
import printerService from "@/services/printer-service"
import thermalPrinter from "@/services/thermal-printer"
import { Ionicons } from "@expo/vector-icons"
import { useFonts } from "expo-font"
import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import {
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  View,
} from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import Toast from "react-native-toast-message"
import "./global.css"

function AppLayout() {
  const { authenticated, loading, setAuthenticated } = useAuth()
  const router = useRouter()
  const [fontsLoaded] = useFonts({
    "Inter-Light": require("../assets/fonts/Inter-Light.ttf"),
    "Inter-Regular": require("../assets/fonts/Inter-Regular.ttf"),
    "Inter-Medium": require("../assets/fonts/Inter-Medium.ttf"),
    "Inter-SemiBold": require("../assets/fonts/Inter-SemiBold.ttf"),
    "Inter-Bold": require("../assets/fonts/Inter-Bold.ttf"),
  })

  useEffect(() => {
    if (!authenticated) {
      return
    }

    printerService.retryPendingJobs() // solves for app crashes

    const handleReconnect = () => {
      printerService.retryPendingJobs()
    }

    thermalPrinter.onPrinterConnected(handleReconnect) // solves when printer goes offline
  }, [authenticated])

  useEffect(() => {
    if (authenticated) {
      router.replace("/")
    }
  }, [authenticated])

  if (!fontsLoaded || loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#e6aa6b" />
      </View>
    )
  }

  if (!authenticated) {
    // ⚠️ DO NOT include OrderProvider here!
    return (
      <Stack>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack>
    )
  }

  return (
    <ThemeProvider>
      <OrderProvider>
        <SocketProvider>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="new-order-alert/[id]"
              options={{
                headerShown: false,
                presentation: "transparentModal",
              }}
            />
            <Stack.Screen
              name="order-details/[id]"
              options={{
                headerShown: Platform.OS === "ios" ? true : false,
                presentation: Platform.OS === "ios" ? "modal" : "formSheet",
              }}
            />
            <Stack.Screen
              name="bluetooth-printer-setup"
              options={{
                title: "Bluetooth Printer Setup",
                headerShown: true,
                headerTitleStyle: {
                  fontFamily: "Inter-SemiBold",
                },
                headerLeft: () => (
                  <TouchableOpacity
                    onPress={() => router.back()}
                    className="ml-2"
                  >
                    <Ionicons name="arrow-back" size={24} color="#000" />
                  </TouchableOpacity>
                ),
              }}
            />
            <Stack.Screen
              name="printer-test"
              options={{
                title: "Printer Test",
                headerShown: true,
                headerTitleStyle: {
                  fontFamily: "Inter-SemiBold",
                },
                headerLeft: () => (
                  <TouchableOpacity
                    onPress={() => router.back()}
                    className="ml-2"
                  >
                    <Ionicons name="arrow-back" size={24} color="#000" />
                  </TouchableOpacity>
                ),
              }}
            />
          </Stack>
          <Toast />
        </SocketProvider>
      </OrderProvider>
    </ThemeProvider>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </GestureHandlerRootView>
  )
}
