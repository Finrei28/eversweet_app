"use client"
import { Order } from "@/lib/types"
import { AuthProvider, useAuth } from "@/providers/auth-provider"
import { ThemeProvider } from "@/providers/theme-provider"
import newOrderServices from "@/services/newOrders-service"
import printerService from "@/services/printer-service"
import socketService, { syncPendingOrders } from "@/services/socket-service"
import thermalPrinter from "@/services/thermal-printer"
import { useOrderStore } from "@/store/order-store"
import { Ionicons } from "@expo/vector-icons"
import { useFonts } from "expo-font"
import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  View,
} from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import Toast from "react-native-toast-message"
import "./global.css"
import NewOrderModal from "./new-order-alert/newOrderModal"

function AppLayout() {
  const { authenticated, loading } = useAuth()
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null)
  const router = useRouter()
  const [fontsLoaded] = useFonts({
    "Inter-Light": require("../assets/fonts/Inter-Light.ttf"),
    "Inter-Regular": require("../assets/fonts/Inter-Regular.ttf"),
    "Inter-Medium": require("../assets/fonts/Inter-Medium.ttf"),
    "Inter-SemiBold": require("../assets/fonts/Inter-SemiBold.ttf"),
    "Inter-Bold": require("../assets/fonts/Inter-Bold.ttf"),
  })

  useEffect(() => {
    const unsubscribe = newOrderServices.subscribe(setCurrentOrder)

    return unsubscribe
  }, [])

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

  // Order data + socket connection are only relevant while authenticated
  useEffect(() => {
    if (!authenticated) {
      socketService.disconnect()
      useOrderStore.getState().reset()
      return
    }

    useOrderStore.getState().fetchOrders()
    // The Upcoming list, rebuilt from the server rather than waited for on the
    // socket. `connect` asks for the same sync, so this only matters when the
    // socket cannot be reached — but that is exactly when staff most need to
    // see what is already booked.
    void syncPendingOrders()
    socketService.connect()

    return () => {
      socketService.disconnect()
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
    return (
      <Stack>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack>
    )
  }

  return (
    <ThemeProvider>
      <StatusBar style="auto" />
      {currentOrder && (
        <NewOrderModal order={currentOrder} visible={!!currentOrder} />
      )}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="order-details/[id]"
          options={{
            headerShown: Platform.OS === "ios" ? true : false,
            presentation: Platform.OS === "ios" ? "modal" : "formSheet",
          }}
        />
        <Stack.Screen
          name="leaderboard-prizes"
          options={{
            title: "Monthly Winners",
            headerShown: true,
            headerTitleStyle: {
              fontFamily: "Inter-SemiBold",
            },
            headerLeft: () => (
              <TouchableOpacity onPress={() => router.back()} className="ml-2">
                <Ionicons name="arrow-back" size={24} color="#000" />
              </TouchableOpacity>
            ),
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
              <TouchableOpacity onPress={() => router.back()} className="ml-2">
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
              <TouchableOpacity onPress={() => router.back()} className="ml-2">
                <Ionicons name="arrow-back" size={24} color="#000" />
              </TouchableOpacity>
            ),
          }}
        />
      </Stack>
      <Toast />
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
