import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Alert, Platform } from "react-native"
import { getToken } from "./authToken"
import * as SecureStore from "expo-secure-store"
import { getUsersMembership } from "./stripe-api"

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * Register for push notifications and return the token
 */

const url = process.env.EXPO_PUBLIC_URL!

export async function registerForPushNotificationsAsync() {
  let token

  // Check if device is physical (not simulator/emulator)
  if (Device.isDevice) {
    // Check if we have permission, if not request it
    const { status: existingStatus } = await Notifications.getPermissionsAsync()

    let finalStatus = existingStatus

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    // If we don't have permission, return null
    if (finalStatus !== "granted") {
      Alert.alert(
        "Please turn on notifications to receive order status changes",
      )
      return null
    }
    // Get the token
    try {
      token = (
        await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_EXPO_PROJECT_ID!, // Your Expo project ID
        })
      ).data
    } catch (error) {
      console.error((error as Error).message)
    }
  } else {
    console.log("Must use physical device for push notifications")
  }

  // For Android, we need to set up a notification channel
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    })
  }

  return token
}

/**
 * Save the push notification token to the server
 */
export async function savePushToken(pushToken: string) {
  try {
    const authToken = await getToken()
    if (!authToken) {
      throw new Error(
        "Please sign in to receive notifications about your orders",
      )
    }

    const response = await fetch(`${url}/api/notification/pushToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ pushToken }),
    })

    if (!response.ok) {
      throw new Error("Failed to save push token")
    }

    return true
  } catch (error) {
    console.error("Error saving push token:", error)
    return false
  }
}

/**
 * Set up notification listeners
 */
export function setupNotificationListeners(
  onNotification: (notification: Notifications.Notification) => void,
) {
  // This listener is fired whenever a notification is received while the app is foregrounded
  const foregroundSubscription =
    Notifications.addNotificationReceivedListener(onNotification)

  // This listener is fired whenever a user taps on or interacts with a notification
  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const { notification } = response
      // Handle notification interaction
      onNotification(notification)
    })

  // Return the subscriptions so they can be unsubscribed later
  return {
    unsubscribe: () => {
      foregroundSubscription.remove()
      responseSubscription.remove()
    },
  }
}

/**
 * Handle a received notification
 */
export function handleNotification(
  notification: Notifications.Notification,
  onNavigate: (path: string) => void,
) {
  const data = notification.request.content.data

  // You can handle different notification types here
  if (data.type === "ORDER_STATUS_CHANGED") {
    // Navigate to the order details screen or update UI
    onNavigate("/orders")

    // You could use a navigation ref or event emitter to navigate
    // Example: navigationRef.current?.navigate('OrderDetails', { orderId: data.orderId })
  }
}

export const setMembershipPopupExpiration = async () => {
  const expiration = new Date()
  expiration.setMonth(expiration.getMonth() + 1) // 1 month later

  await SecureStore.setItemAsync(
    "showMembershipPopup",
    `${expiration.getTime()}`,
  )
}

// Read the flag and check if it has expired
export const hasMembershipPopupExpired = async (): Promise<boolean> => {
  try {
    const usersMembership = await getUsersMembership()
    if (usersMembership?.isActive) {
      return false
    } // don't show if user is already a member

    const dataStr = await SecureStore.getItemAsync("showMembershipPopup")
    if (!dataStr) return true // default: show popup if nothing stored
    if (Date.now() > Number(dataStr)) {
      // expired, remove it
      await SecureStore.deleteItemAsync("showMembershipPopup")
      return true // show popup again
    }
    return false
  } catch {
    return true // fallback in case of corrupted data
  }
}
