import { Platform } from "react-native"
import {
  PERMISSIONS,
  RESULTS,
  checkMultiple,
  openSettings,
  requestMultiple,
} from "react-native-permissions"

// Define the permissions needed for Bluetooth functionality
const BLUETOOTH_PERMISSIONS = Platform.select({
  android: [
    // For Android 12+ (API level 31+)
    ...(Number(Platform.Version) >= 31
      ? [
          PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
          PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
        ]
      : []),
    // For Android 10+ (API level 29+)
    ...(Number(Platform.Version) >= 29
      ? [PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION]
      : [PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION]),
  ],
  ios: [PERMISSIONS.IOS.BLUETOOTH],
  default: [],
})

/**
 * Check if all required Bluetooth permissions are granted
 * @returns Promise<boolean> - True if all permissions are granted
 */
export const checkBluetoothPermissions = async (): Promise<boolean> => {
  try {
    if (!BLUETOOTH_PERMISSIONS || BLUETOOTH_PERMISSIONS.length === 0) {
      return true // No permissions needed for this platform
    }

    const statuses = await checkMultiple(BLUETOOTH_PERMISSIONS)

    // Check if all permissions are granted
    return Object.values(statuses).every((status) => status === RESULTS.GRANTED)
  } catch (error) {
    console.error("Error checking Bluetooth permissions:", error)
    return false
  }
}

/**
 * Request all required Bluetooth permissions
 * @returns Promise<boolean> - True if all permissions are granted
 */
export const requestBluetoothPermissions = async (): Promise<boolean> => {
  try {
    if (!BLUETOOTH_PERMISSIONS || BLUETOOTH_PERMISSIONS.length === 0) {
      return true // No permissions needed for this platform
    }

    const statuses = await requestMultiple(BLUETOOTH_PERMISSIONS)

    // Check if all permissions are granted
    const allGranted = Object.values(statuses).every(
      (status) => status === RESULTS.GRANTED
    )

    return allGranted
  } catch (error) {
    console.error("Error requesting Bluetooth permissions:", error)
    return false
  }
}

/**
 * Open device settings to allow the user to manually grant permissions
 */
export const openAppSettings = async (): Promise<void> => {
  await openSettings()
}
