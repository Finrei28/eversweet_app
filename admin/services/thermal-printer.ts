import { formatTime, getCollectionTime } from "@/lib/formatters"
import { Order } from "@/lib/types"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Buffer } from "buffer"
import EventEmitter from "events"
import { Platform } from "react-native"
import {
  BleManager,
  type Characteristic,
  type Device,
  type Service,
} from "react-native-ble-plx"
import { check, PERMISSIONS, request, RESULTS } from "react-native-permissions"

// Storage keys
const PRINTERS_STORAGE_KEY = "thermal_printers"
const DEFAULT_PRINTER_KEY = "default_thermal_printer"

// ESC/POS Commands
export const ESC = "\x1B"
export const GS = "\x1D"
export const INIT = ESC + "@"
export const ALIGN_CENTER = ESC + "a" + "\x01"
export const ALIGN_LEFT = ESC + "a" + "\x00"
export const ALIGN_RIGHT = ESC + "a" + "\x02"
export const BOLD_ON = ESC + "E" + "\x01"
export const BOLD_OFF = ESC + "E" + "\x00"
export const TEXT_SIZE_NORMAL = GS + "!" + "\x10"
export const TEXT_SIZE_LARGE = GS + "!" + "\x11"
export const LINE_FEED = "\x0A"
export const CUT_PAPER = GS + "V" + "\x41" + "\x03"

// Printer types and interfaces
export type PrinterType = "bluetooth"

export interface Printer {
  id: string
  name: string
  type: PrinterType
  address: string
  isDefault: boolean
}

export interface PrintResult {
  success: boolean
  message: string
}

// Common service UUIDs for thermal printers
// Note: These may vary by printer model - you might need to adjust these
const PRINTER_SERVICE_UUIDS = [
  "18f0", // Common for many ESC/POS printers
  "1812", // BLE Printer Service
  "000018f0-0000-1000-8000-00805f9b34fb", // Full UUID format
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // Some printer models
]

// Common characteristic UUIDs for writing to thermal printers
const PRINTER_CHARACTERISTIC_UUIDS = [
  "2af1", // Common write characteristic
  "2a2b", // Another common characteristic
  "00002af1-0000-1000-8000-00805f9b34fb", // Full UUID format
  "49535343-8841-43f4-a8d4-ecbe34729bb3", // Some printer models
]

class ThermalPrinterService {
  private bleManager: BleManager
  private isScanning = false
  private connectedDevice: Device | null = null
  private writeCharacteristic: Characteristic | null = null
  private writeService: Service | null = null
  private discoveredDevices: Map<string, Device> = new Map()
  private eventEmitter = new EventEmitter()

  constructor() {
    this.bleManager = new BleManager()
    this.setupBleListener()
  }

  private setupBleListener() {
    // Listen for state changes
    this.bleManager.onStateChange((state) => {
      // console.log("Bluetooth state changed to:", state)
    }, true)
  }

  onScanStateChange(callback: (isScanning: boolean) => void) {
    this.eventEmitter.on("scanStateChange", callback)
  }

  private emitScanStateChange() {
    this.eventEmitter.emit("scanStateChange", this.isScanning)
  }

  /**
   * Check if Bluetooth is enabled
   */
  async isBluetoothEnabled(): Promise<boolean> {
    const state = await this.bleManager.state()
    return state === "PoweredOn"
  }

  /**
   * Request Bluetooth permissions
   */
  async requestBluetoothPermissions(): Promise<boolean> {
    if (Platform.OS === "ios") {
      const result = await request(PERMISSIONS.IOS.BLUETOOTH)
      return result === RESULTS.GRANTED
    } else if (Platform.OS === "android") {
      // For Android 12+ (SDK 31+)
      if (Platform.Version >= 31) {
        const scanResult = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN)
        const connectResult = await request(
          PERMISSIONS.ANDROID.BLUETOOTH_CONNECT
        )
        return (
          scanResult === RESULTS.GRANTED && connectResult === RESULTS.GRANTED
        )
      } else {
        // For older Android versions
        const result = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION)
        return result === RESULTS.GRANTED
      }
    }
    return false
  }

  /**
   * Start scanning for Bluetooth devices
   */
  async startScan(): Promise<void> {
    if (this.isScanning) return

    const state = await this.bleManager.state()
    if (state !== "PoweredOn") {
      throw new Error("Bluetooth is not powered on")
    }

    // Request permissions if needed
    const hasPermissions = await this.checkPermissions()
    if (!hasPermissions) {
      const granted = await this.requestBluetoothPermissions()
      if (!granted) {
        throw new Error("Bluetooth permissions not granted")
      }
    }

    this.isScanning = true
    this.emitScanStateChange()
    this.discoveredDevices.clear()
    // console.log("Starting BLE scan...")

    // Stop any existing scan
    this.bleManager.stopDeviceScan()
    // console.log("🔍 Starting Bluetooth scan...")
    // Start scanning
    return new Promise((resolve) => {
      this.bleManager.startDeviceScan(
        null, // Scan for all services
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.error("Scan error:", error)
            this.isScanning = false
            resolve()
            return
          }

          if (device && device.name) {
            this.discoveredDevices.set(device.id, device)
            // console.log("Found device:", device.name, device.id)
          }
        }
      )

      // Stop scan after 10 seconds to save battery
      setTimeout(() => {
        this.stopScan()
        resolve()
      }, 10000)
    })
  }

  /**
   * Stop scanning for devices
   */
  stopScan(): void {
    if (this.isScanning) {
      this.bleManager.stopDeviceScan()
      this.isScanning = false
      this.emitScanStateChange()
      // console.log("BLE scan stopped")
    }
  }

  /**
   * Check if we have the necessary permissions
   */
  private async checkPermissions(): Promise<boolean> {
    if (Platform.OS === "ios") {
      const result = await check(PERMISSIONS.IOS.BLUETOOTH)
      return result === RESULTS.GRANTED
    } else if (Platform.OS === "android") {
      // For Android 12+ (SDK 31+)
      if (Platform.Version >= 31) {
        const scanResult = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN)
        const connectResult = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT)
        return (
          scanResult === RESULTS.GRANTED && connectResult === RESULTS.GRANTED
        )
      } else {
        // For older Android versions
        const result = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION)
        return result === RESULTS.GRANTED
      }
    }
    return false
  }

  /**
   * Get discovered devices
   */
  async getDiscoveredDevices(): Promise<Device[]> {
    // This is a placeholder - in a real implementation, you would track discovered devices
    // during the scan and return them here
    return Array.from(this.discoveredDevices.values())
  }

  /**
   * Get saved printers from storage
   */
  async getSavedPrinters(): Promise<Printer[]> {
    try {
      const printersJson = await AsyncStorage.getItem(PRINTERS_STORAGE_KEY)
      return printersJson ? JSON.parse(printersJson) : []
    } catch (error) {
      console.error("Error getting saved printers:", error)
      return []
    }
  }

  /**
   * Save a printer to storage
   */
  async savePrinter(device: Device, isDefault = false): Promise<boolean> {
    try {
      const printers = await this.getSavedPrinters()

      // Check if printer already exists
      const existingIndex = printers.findIndex((p) => p.id === device.id)

      const printer: Printer = {
        id: device.id,
        name: device.name || "Unknown Printer",
        type: "bluetooth",
        address: device.id,
        isDefault: isDefault,
      }

      // If this is the default printer, remove default from others
      if (isDefault) {
        printers.forEach((p) => {
          p.isDefault = false
        })
      }

      if (existingIndex >= 0) {
        // Update existing printer
        printers[existingIndex] = {
          ...printers[existingIndex],
          ...printer,
        }
      } else {
        // Add new printer
        printers.push(printer)
      }

      await AsyncStorage.setItem(PRINTERS_STORAGE_KEY, JSON.stringify(printers))

      // If this is the default printer, also save it separately
      if (isDefault) {
        await AsyncStorage.setItem(DEFAULT_PRINTER_KEY, device.id)
      }

      return true
    } catch (error) {
      console.error("Error saving printer:", error)
      return false
    }
  }

  /**
   * Remove a saved printer
   */
  async removePrinter(printerId: string): Promise<boolean> {
    try {
      const printers = await this.getSavedPrinters()
      const updatedPrinters = printers.filter((p) => p.id !== printerId)

      await AsyncStorage.setItem(
        PRINTERS_STORAGE_KEY,
        JSON.stringify(updatedPrinters)
      )

      // If this was the default printer, clear the default
      const defaultPrinterId = await AsyncStorage.getItem(DEFAULT_PRINTER_KEY)
      if (defaultPrinterId === printerId) {
        await AsyncStorage.removeItem(DEFAULT_PRINTER_KEY)
      }

      return true
    } catch (error) {
      console.error("Error removing printer:", error)
      return false
    }
  }

  /**
   * Get the default printer
   */
  async getDefaultPrinter(): Promise<Printer | null> {
    try {
      const defaultPrinterId = await AsyncStorage.getItem(DEFAULT_PRINTER_KEY)
      if (!defaultPrinterId) return null

      const printers = await this.getSavedPrinters()
      return printers.find((p) => p.id === defaultPrinterId) || null
    } catch (error) {
      console.error("Error getting default printer:", error)
      return null
    }
  }

  /**
   * Set a printer as the default
   */
  async setDefaultPrinter(printerId: string): Promise<boolean> {
    try {
      const printers = await this.getSavedPrinters()

      // Update isDefault flag for all printers
      const updatedPrinters = printers.map((p) => ({
        ...p,
        isDefault: p.id === printerId,
      }))

      await AsyncStorage.setItem(
        PRINTERS_STORAGE_KEY,
        JSON.stringify(updatedPrinters)
      )
      await AsyncStorage.setItem(DEFAULT_PRINTER_KEY, printerId)

      return true
    } catch (error) {
      console.error("Error setting default printer:", error)
      return false
    }
  }

  /**
   * Connect to a printer by ID
   */
  async connectToPrinter(deviceId: string): Promise<boolean> {
    try {
      // If already connected to this device, return success
      if (this.connectedDevice && this.connectedDevice.id === deviceId) {
        return true
      }

      // If connected to a different device, disconnect first
      if (this.connectedDevice) {
        await this.disconnectPrinter()
      }

      // console.log(`Connecting to device: ${deviceId}`)

      // Connect to the device
      const device = await this.bleManager.connectToDevice(deviceId)
      // console.log("Connected to device:", device.name)

      // Discover services and characteristics
      await device.discoverAllServicesAndCharacteristics()
      // console.log("Discovered services and characteristics")

      // Find the printer service and characteristic
      const services = await device.services()

      let foundService: Service | null = null
      let foundCharacteristic: Characteristic | null = null

      // Look for known printer service UUIDs
      for (const service of services) {
        const serviceUuid = service.uuid.toLowerCase()

        // Check if this service matches any known printer service UUIDs
        const isKnownService = PRINTER_SERVICE_UUIDS.some((uuid) =>
          serviceUuid.includes(uuid.toLowerCase())
        )

        if (isKnownService) {
          // console.log("Found potential printer service:", serviceUuid)
          foundService = service

          // Look for a writable characteristic
          const characteristics = await service.characteristics()

          for (const characteristic of characteristics) {
            if (
              characteristic.isWritableWithResponse ||
              characteristic.isWritableWithoutResponse
            ) {
              // Check if this is a known printer characteristic
              const charUuid = characteristic.uuid.toLowerCase()
              const isKnownChar = PRINTER_CHARACTERISTIC_UUIDS.some((uuid) =>
                charUuid.includes(uuid.toLowerCase())
              )

              if (isKnownChar) {
                // console.log("Found potential printer characteristic:", charUuid)
                foundCharacteristic = characteristic
                break
              }
            }
          }

          // If we found a characteristic, break out of the service loop
          if (foundCharacteristic) break
        }
      }

      // If we couldn't find a known service/characteristic, try to find any writable characteristic
      if (!foundCharacteristic) {
        for (const service of services) {
          const characteristics = await service.characteristics()

          for (const characteristic of characteristics) {
            if (
              characteristic.isWritableWithResponse ||
              characteristic.isWritableWithoutResponse
            ) {
              // console.log("Found writable characteristic:", characteristic.uuid)
              foundService = service
              foundCharacteristic = characteristic
              break
            }
          }

          if (foundCharacteristic) break
        }
      }

      if (!foundService || !foundCharacteristic) {
        console.error(
          "Could not find a suitable service and characteristic for printing"
        )
        await this.bleManager.cancelDeviceConnection(device.id)
        return false
      }

      this.connectedDevice = device
      this.writeService = foundService
      this.writeCharacteristic = foundCharacteristic

      return true
    } catch (error) {
      console.error("Error connecting to printer:", error)
      return false
    }
  }

  /**
   * Disconnect from the current printer
   */
  async disconnectPrinter(): Promise<void> {
    if (this.connectedDevice) {
      try {
        await this.bleManager.cancelDeviceConnection(this.connectedDevice.id)
        // console.log("Disconnected from device:", this.connectedDevice.name)
      } catch (error) {
        console.error("Error disconnecting from printer:", error)
      } finally {
        this.connectedDevice = null
        this.writeService = null
        this.writeCharacteristic = null
      }
    }
  }

  /**
   * Check if connected to a printer
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.writeCharacteristic !== null
  }

  /**
   * Get the connected printer device
   */
  getConnectedPrinter(): Device | null {
    return this.connectedDevice
  }

  /**
   * Print raw text with ESC/POS commands
   */
  async printRawText(text: string): Promise<PrintResult> {
    if (!this.isConnected()) {
      return { success: false, message: "No printer connected" }
    }

    try {
      if (!this.writeService || !this.writeCharacteristic) {
        return {
          success: false,
          message: "Printer service or characteristic not found",
        }
      }

      // Convert text to bytes
      const data = this.textToBytes(text)

      // Write to the characteristic
      await this.connectedDevice!.writeCharacteristicWithResponseForService(
        this.writeService.uuid,
        this.writeCharacteristic.uuid,
        data
      )

      return { success: true, message: "Text printed successfully" }
    } catch (error) {
      console.error("Error printing text:", error)
      return { success: false, message: `Error printing text: ${error}` }
    }
  }

  /**
   * Print a test page
   */
  async printTestPage(): Promise<PrintResult> {
    if (!this.isConnected()) {
      return { success: false, message: "No printer connected" }
    }

    try {
      let testText = ""

      // Header
      testText += INIT
      testText += ALIGN_CENTER
      testText += BOLD_ON
      testText += TEXT_SIZE_LARGE
      testText += "TEST PAGE"
      testText += LINE_FEED
      testText += TEXT_SIZE_LARGE
      testText += "Printer Test"
      testText += LINE_FEED + LINE_FEED
      testText += BOLD_OFF

      // Text formatting tests
      testText += ALIGN_LEFT
      testText += "ALIGNMENT TEST"
      testText += LINE_FEED
      testText += "--------------------------------"
      testText += LINE_FEED
      testText += ALIGN_LEFT
      testText += "Left aligned text"
      testText += LINE_FEED
      testText += ALIGN_CENTER
      testText += "Center aligned text"
      testText += LINE_FEED
      testText += ALIGN_RIGHT
      testText += "Right aligned text"
      testText += LINE_FEED
      testText += ALIGN_LEFT
      testText += LINE_FEED

      // Font style tests
      testText += "FONT STYLE TEST"
      testText += LINE_FEED
      testText += "--------------------------------"
      testText += LINE_FEED
      testText += "Normal text"
      testText += LINE_FEED
      testText += BOLD_ON
      testText += "Bold text"
      testText += BOLD_OFF
      testText += LINE_FEED
      testText += TEXT_SIZE_LARGE
      testText += "Large text"
      testText += TEXT_SIZE_LARGE
      testText += LINE_FEED + LINE_FEED

      // Character test
      testText += "CHARACTER TEST"
      testText += LINE_FEED
      testText += "--------------------------------"
      testText += LINE_FEED
      testText += "Numbers: 0123456789"
      testText += LINE_FEED
      testText += "Symbols: !@#$%^&*()_+-=[]{}|;:,.<>?/"
      testText += LINE_FEED
      testText += "Letters: abcdefghijklmnopqrstuvwxyz"
      testText += LINE_FEED
      testText += "LETTERS: ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      testText += LINE_FEED + LINE_FEED

      // Footer
      testText += ALIGN_CENTER
      testText += "End of test page"
      testText += LINE_FEED
      testText += "If you can read this, your printer is working!"
      testText += LINE_FEED + LINE_FEED + LINE_FEED + LINE_FEED
      testText += CUT_PAPER

      return await this.printRawText(testText)
    } catch (error) {
      console.error("Error printing test page:", error)
      return { success: false, message: `Error printing test page: ${error}` }
    }
  }

  /**
   * Print a receipt
   */
  async printReceipt(orderData: Order): Promise<PrintResult> {
    if (!this.isConnected()) {
      return { success: false, message: "No printer connected" }
    }

    try {
      let receiptText = ""

      // Initialize printer
      receiptText += INIT

      // Add header
      receiptText += ALIGN_CENTER
      receiptText += BOLD_ON
      receiptText += TEXT_SIZE_LARGE
      receiptText += "EVERSWEET"
      receiptText += LINE_FEED
      receiptText += TEXT_SIZE_NORMAL
      receiptText += "5D/119 Meadowland Drive"
      receiptText += LINE_FEED
      receiptText += "Somerville, Auckland 2014"
      receiptText += LINE_FEED + LINE_FEED
      receiptText += BOLD_OFF

      // Order info
      receiptText += ALIGN_LEFT
      receiptText += "Order #: " + orderData.tempOrderId
      receiptText += LINE_FEED
      receiptText += "Date: " + getCollectionTime(new Date())
      receiptText += LINE_FEED
      receiptText += BOLD_ON
      receiptText += orderData.dineIn ? "EAT IN" : "TAKE AWAY"
      receiptText += BOLD_OFF
      receiptText += LINE_FEED
      receiptText +=
        "Customer: " +
        orderData.customerFirstName +
        " " +
        orderData.customerLastName
      receiptText += LINE_FEED
      receiptText += LINE_FEED

      // Items
      receiptText += BOLD_ON
      receiptText += "ITEMS"
      receiptText += BOLD_OFF
      receiptText += LINE_FEED
      receiptText += "--------------------------------"
      receiptText += LINE_FEED

      orderData.desserts.forEach((item) => {
        receiptText += item.quantity + "x " + item.dessert.name
        receiptText += LINE_FEED

        // Add customizations if any
        if (item.customisations && item.customisations.length > 0) {
          item.customisations.forEach((mod) => {
            receiptText +=
              mod.quantity === 0
                ? "   - " + mod.customisation.name
                : "   + " + mod.customisation.name + ": " + mod.quantity + "x"
            receiptText += LINE_FEED
          })
        }

        const pricePerItem =
          (item.priceInCents - item.discountedAmountInCents) / 100

        // Add item price
        receiptText += ALIGN_RIGHT
        receiptText += "$" + (pricePerItem * item.quantity).toFixed(2)
        receiptText += ALIGN_LEFT
        receiptText += LINE_FEED
      })

      receiptText += "--------------------------------"
      receiptText += LINE_FEED

      // Totals
      receiptText += ALIGN_RIGHT
      receiptText +=
        "Subtotal: $" +
        (
          (orderData.priceInCents - orderData.discountedAmountInCents) /
          100
        ).toFixed(2)
      receiptText += LINE_FEED
      receiptText += "GST: $" + (orderData.GST / 100).toFixed(2)
      receiptText += LINE_FEED

      receiptText += BOLD_ON
      receiptText +=
        "TOTAL: $" +
        (
          (orderData.priceInCents - orderData.discountedAmountInCents) /
          100
        ).toFixed(2)
      receiptText += BOLD_OFF
      receiptText += LINE_FEED + LINE_FEED

      // Footer
      receiptText += ALIGN_CENTER
      receiptText += `Desired ${orderData.dineIn ? "eat in" : "pick up"} time`
      receiptText += LINE_FEED
      receiptText += formatTime(new Date(orderData.pickUpTime))
      receiptText += LINE_FEED + LINE_FEED + LINE_FEED + LINE_FEED

      // Cut paper
      receiptText += CUT_PAPER

      return await this.printRawText(receiptText)
    } catch (error) {
      console.error("Error printing receipt:", error)
      return { success: false, message: `Error printing receipt: ${error}` }
    }
  }

  /**
   * Convert text to bytes for BLE transmission
   */
  private textToBytes(text: string): string {
    // For BLE, we need to encode the text as base64
    return Buffer.from(text).toString("base64")
  }
}

// Create and export a singleton instance
const thermalPrinter = new ThermalPrinterService()
export default thermalPrinter
