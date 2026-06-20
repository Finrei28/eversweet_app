"use client"

import thermalPrinter, { type Printer } from "@/services/thermal-printer"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import type { Device } from "react-native-ble-plx"
import { check, PERMISSIONS, RESULTS } from "react-native-permissions"

export default function BluetoothPrinterSetup() {
  const navigation = useNavigation()
  const [isScanning, setIsScanning] = useState(false)
  const [availableDevices, setAvailableDevices] = useState<Device[]>([])
  const [savedPrinters, setSavedPrinters] = useState<Printer[]>([])
  const [defaultPrinterId, setDefaultPrinterId] = useState<string | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null)
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false)

  useEffect(() => {
    checkPermissions()
    checkBluetoothStatus()
    loadSavedPrinters()
  }, [])

  const checkPermissions = async () => {
    let result
    if (Platform.OS === "ios") {
      result = await check(PERMISSIONS.IOS.BLUETOOTH)
    } else if (Platform.OS === "android") {
      // For Android 12+ (SDK 31+)
      if (Platform.Version >= 31) {
        result = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT)
      } else {
        result = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION)
      }
    }

    setPermissionStatus(result?.toString() || null)
  }

  const requestPermissions = async () => {
    try {
      const granted = await thermalPrinter.requestBluetoothPermissions()
      setPermissionStatus(granted ? RESULTS.GRANTED : RESULTS.DENIED)

      if (granted) {
        checkBluetoothStatus()
      }
    } catch (error) {
      console.error("Error requesting permissions:", error)
      Alert.alert("Permission Error", "Failed to request Bluetooth permissions")
    }
  }

  const checkBluetoothStatus = async () => {
    try {
      const isEnabled = await thermalPrinter.isBluetoothEnabled()
      setBluetoothEnabled(isEnabled)
    } catch (error) {
      console.error("Error checking Bluetooth status:", error)
    }
  }

  const loadSavedPrinters = async () => {
    try {
      const printers = await thermalPrinter.getSavedPrinters()
      setSavedPrinters(printers)

      const defaultPrinter = await thermalPrinter.getDefaultPrinter()
      if (defaultPrinter) {
        setDefaultPrinterId(defaultPrinter.id)
      }
    } catch (error) {
      console.error("Error loading saved printers:", error)
    }
  }

  const startScan = async () => {
    if (!bluetoothEnabled) {
      Alert.alert(
        "Bluetooth is Off",
        "Please turn on Bluetooth to scan for printers.",
        [{ text: "OK" }],
      )
      return
    }

    setAvailableDevices([])

    try {
      thermalPrinter.onScanStateChange(setIsScanning)
      await thermalPrinter.startScan()
      const printers = await thermalPrinter.getDiscoveredDevices()

      // For demo purposes, we'll show some mock devices
      // In a real app, you'd get these from the scan results

      setAvailableDevices(printers)
    } catch (error) {
      console.error("Error scanning for devices:", error)
      setIsScanning(false)

      Alert.alert(
        "Scan Error",
        "There was an error scanning for Bluetooth devices. Please make sure Bluetooth is enabled.",
        [{ text: "OK" }],
      )
    }
  }

  const stopScan = () => {
    thermalPrinter.stopScan()
    setIsScanning(false)
  }

  const connectToDevice = async (device: Device) => {
    try {
      const connected = await thermalPrinter.connectToPrinter(device.id)

      if (connected) {
        Alert.alert(
          "Connected",
          `Successfully connected to ${
            device.name || "printer"
          }. Would you like to save this printer?`,
          [
            {
              text: "No",
              style: "cancel",
              onPress: () => thermalPrinter.disconnectPrinter(),
            },
            {
              text: "Yes",
              onPress: async () => {
                const success = await thermalPrinter.savePrinter(device)

                if (success) {
                  loadSavedPrinters()
                  await setAsDefault(device.id)
                } else {
                  Alert.alert("Error", "Failed to save printer")
                }
              },
            },
          ],
        )
      } else {
        Alert.alert(
          "Connection Failed",
          `Could not connect to ${device.name || "printer"}. Please try again.`,
          [{ text: "OK" }],
        )
      }
    } catch (error) {
      console.error("Error connecting to device:", error)
      Alert.alert(
        "Connection Error",
        "There was an error connecting to the printer. Please try again.",
        [{ text: "OK" }],
      )
    }
  }

  const setAsDefault = async (deviceId: string) => {
    await thermalPrinter.setDefaultPrinter(deviceId)
    setDefaultPrinterId(deviceId)

    Alert.alert(
      "Default Printer Set",
      "This printer has been set as your default printer.",
      [{ text: "OK" }],
    )
  }

  const removePrinter = async (deviceId: string) => {
    Alert.alert(
      "Remove Printer",
      "Are you sure you want to remove this printer?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await thermalPrinter.removePrinter(deviceId)
            loadSavedPrinters()
          },
        },
      ],
    )
  }

  const testPrinter = async (deviceId: string) => {
    try {
      const connected = await thermalPrinter.connectToPrinter(deviceId)

      if (connected) {
        navigation.navigate("printer-test" as never)
      } else {
        Alert.alert(
          "Connection Failed",
          "Could not connect to the printer. Please try again.",
          [{ text: "OK" }],
        )
      }
    } catch (error) {
      console.error("Error connecting to printer for test:", error)
      Alert.alert(
        "Connection Error",
        "There was an error connecting to the printer. Please try again.",
        [{ text: "OK" }],
      )
    }
  }

  // Render permission request screen if permissions not granted
  if (permissionStatus !== RESULTS.GRANTED) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bluetooth Permissions</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.permissionContainer}>
          <Ionicons name="bluetooth" size={64} color="#007AFF" />
          <Text style={styles.permissionTitle}>
            Bluetooth Permission Required
          </Text>
          <Text style={styles.permissionText}>
            This app needs Bluetooth permission to connect to your thermal
            printer. Please grant permission to continue.
          </Text>

          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermissions}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bluetooth Printer Setup</Text>
        <View style={{ width: 24 }} />
      </View> */}

      {/* Saved Printers Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Saved Printers</Text>
        {savedPrinters.length === 0 ? (
          <Text style={styles.emptyText}>No saved printers</Text>
        ) : (
          <FlatList
            data={savedPrinters}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.deviceItem}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>
                    {item.name || "Unknown Device"}
                  </Text>
                  <Text style={styles.deviceId}>{item.id}</Text>
                  {defaultPrinterId === item.id && (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultText}>Default</Text>
                    </View>
                  )}
                </View>
                <View style={styles.deviceActions}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => testPrinter(item.id)}
                  >
                    <Text style={styles.actionButtonText}>Test</Text>
                  </TouchableOpacity>

                  {defaultPrinterId !== item.id && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => setAsDefault(item.id)}
                    >
                      <Text style={styles.actionButtonText}>Set Default</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.actionButton, styles.removeButton]}
                    onPress={() => removePrinter(item.id)}
                  >
                    <Text style={styles.removeButtonText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* Available Devices Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Available Devices</Text>
          {isScanning ? (
            <TouchableOpacity onPress={stopScan} style={styles.scanButton}>
              <Text style={styles.scanButtonText}>Stop</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={startScan} style={styles.scanButton}>
              <Text style={styles.scanButtonText}>Scan</Text>
            </TouchableOpacity>
          )}
        </View>

        {isScanning ? (
          <View style={styles.scanningContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.scanningText}>Scanning for devices...</Text>
          </View>
        ) : availableDevices.length === 0 ? (
          <Text style={styles.emptyText}>
            No devices found. Tap Scan to search for printers.
          </Text>
        ) : (
          <FlatList
            data={availableDevices}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.deviceItem}
                onPress={() => connectToDevice(item)}
              >
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>
                    {item.name || "Unknown Device"}
                  </Text>
                  <Text style={styles.deviceId}>{item.id}</Text>
                  <Text>{item.isConnectable}</Text>
                  <Text>{item.mtu}</Text>
                  <Text>{item.serviceUUIDs}</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#999" />
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          Note: Make sure your printer is turned on and in pairing mode.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  section: {
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 8,
    marginHorizontal: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  scanButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  scanButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  deviceItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "500",
  },
  deviceId: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
  },
  deviceActions: {
    flexDirection: "row",
  },
  actionButton: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginLeft: 8,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "500",
  },
  removeButton: {
    backgroundColor: "#ffebee",
  },
  removeButtonText: {
    color: "#f44336",
    fontSize: 12,
    fontWeight: "500",
  },
  defaultBadge: {
    backgroundColor: "#e3f2fd",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  defaultText: {
    color: "#2196f3",
    fontSize: 10,
    fontWeight: "600",
  },
  emptyText: {
    color: "#999",
    textAlign: "center",
    marginVertical: 16,
  },
  scanningContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  scanningText: {
    marginTop: 12,
    color: "#666",
  },
  infoContainer: {
    padding: 16,
  },
  infoText: {
    color: "#666",
    fontSize: 12,
    textAlign: "center",
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  permissionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
})
