// import { Order } from "@/lib/types"
// import AsyncStorage from "@react-native-async-storage/async-storage"
// import * as FileSystem from "expo-file-system"
// import * as Print from "expo-print"
// import { shareAsync } from "expo-sharing"
// import { Platform } from "react-native"
// import {
//   BluetoothEscposPrinter,
//   BluetoothManager,
// } from "react-native-bluetooth-escpos-printer"
// import {
//   checkBluetoothPermissions,
//   requestBluetoothPermissions,
// } from "./permissions-service"

// // Define printer types
// export type PrinterType = "bluetooth" | "network" | "usb"

// export type Printer = {
//   id: string
//   name: string
//   type: PrinterType
//   address: string // IP address for network printers, MAC address for Bluetooth
//   port?: number // For network printers
//   defaultPrinter: boolean
// }

// export type BusinessInfo = {
//   name: string
//   address: string
//   phone: string
//   website?: string
//   taxId?: string
// }

// // Storage keys
// const PRINTERS_STORAGE_KEY = "printers"
// const DEFAULT_PRINTER_STORAGE_KEY = "default_printer"
// const BUSINESS_INFO_STORAGE_KEY = "business_info"

// // Get all saved printers
// export const getPrinters = async (): Promise<Printer[]> => {
//   try {
//     const printersJson = await AsyncStorage.getItem(PRINTERS_STORAGE_KEY)
//     return printersJson ? JSON.parse(printersJson) : []
//   } catch (error) {
//     console.error("Error getting printers:", error)
//     return []
//   }
// }

// // Save a printer
// export const savePrinter = async (printer: Printer): Promise<boolean> => {
//   try {
//     const printers = await getPrinters()

//     // If this is set as default, remove default from others
//     if (printer.defaultPrinter) {
//       printers.forEach((p) => {
//         if (p.id !== printer.id) {
//           p.defaultPrinter = false
//         }
//       })
//     }

//     // Check if printer already exists
//     const existingIndex = printers.findIndex((p) => p.id === printer.id)
//     if (existingIndex >= 0) {
//       printers[existingIndex] = printer
//     } else {
//       printers.push(printer)
//     }

//     await AsyncStorage.setItem(PRINTERS_STORAGE_KEY, JSON.stringify(printers))
//     return true
//   } catch (error) {
//     console.error("Error saving printer:", error)
//     return false
//   }
// }

// // Delete a printer
// export const deletePrinter = async (printerId: string): Promise<boolean> => {
//   try {
//     const printers = await getPrinters()
//     const updatedPrinters = printers.filter((p) => p.id !== printerId)
//     await AsyncStorage.setItem(
//       PRINTERS_STORAGE_KEY,
//       JSON.stringify(updatedPrinters)
//     )
//     return true
//   } catch (error) {
//     console.error("Error deleting printer:", error)
//     return false
//   }
// }

// // Get default printer
// export const getDefaultPrinter = async (): Promise<Printer | null> => {
//   try {
//     const printers = await getPrinters()
//     return printers.find((p) => p.defaultPrinter) || null
//   } catch (error) {
//     console.error("Error getting default printer:", error)
//     return null
//   }
// }

// // Set default printer
// export const setDefaultPrinter = async (
//   printerId: string
// ): Promise<boolean> => {
//   try {
//     const printers = await getPrinters()
//     printers.forEach((p) => {
//       p.defaultPrinter = p.id === printerId
//     })
//     await AsyncStorage.setItem(PRINTERS_STORAGE_KEY, JSON.stringify(printers))
//     return true
//   } catch (error) {
//     console.error("Error setting default printer:", error)
//     return false
//   }
// }

// // Get business info
// export const getBusinessInfo = async (): Promise<BusinessInfo> => {
//   try {
//     const infoJson = await AsyncStorage.getItem(BUSINESS_INFO_STORAGE_KEY)
//     return infoJson
//       ? JSON.parse(infoJson)
//       : {
//           name: "Eversweet Cafe",
//           address: "123 Coffee Lane, Seattle, WA 98101",
//           phone: "(555) 123-4567",
//         }
//   } catch (error) {
//     console.error("Error getting business info:", error)
//     return {
//       name: "Eversweet Cafe",
//       address: "123 Coffee Lane, Seattle, WA 98101",
//       phone: "(555) 123-4567",
//     }
//   }
// }

// // Save business info
// export const saveBusinessInfo = async (
//   info: BusinessInfo
// ): Promise<boolean> => {
//   try {
//     await AsyncStorage.setItem(BUSINESS_INFO_STORAGE_KEY, JSON.stringify(info))
//     return true
//   } catch (error) {
//     console.error("Error saving business info:", error)
//     return false
//   }
// }

// // Check if Bluetooth is enabled
// export const isBluetoothEnabled = async (): Promise<boolean> => {
//   try {
//     // First check permissions
//     const hasPermissions = await checkBluetoothPermissions()
//     if (!hasPermissions) {
//       const granted = await requestBluetoothPermissions()
//       if (!granted) {
//         throw new Error("Bluetooth permissions not granted")
//       }
//     }

//     const isEnabled = await BluetoothManager.isBluetoothEnabled()
//     return isEnabled
//   } catch (error) {
//     console.error("Error checking Bluetooth status:", error)
//     return false
//   }
// }

// // Enable Bluetooth
// export const enableBluetooth = async (): Promise<boolean> => {
//   try {
//     // First check permissions
//     const hasPermissions = await checkBluetoothPermissions()
//     if (!hasPermissions) {
//       const granted = await requestBluetoothPermissions()
//       if (!granted) {
//         throw new Error("Bluetooth permissions not granted")
//       }
//     }

//     if (Platform.OS === "android") {
//       const result = await BluetoothManager.enableBluetooth()
//       return result.indexOf("enabled") >= 0
//     }
//     return true // iOS handles this through system settings
//   } catch (error) {
//     console.error("Error enabling Bluetooth:", error)
//     return false
//   }
// }

// // Scan for Bluetooth devices
// export const scanForBluetoothDevices = async (): Promise<any[]> => {
//   try {
//     const hasPermissions = await checkBluetoothPermissions()
//     if (!hasPermissions) {
//       const granted = await requestBluetoothPermissions()
//       if (!granted) {
//         throw new Error("Bluetooth permissions not granted")
//       }
//     }

//     // First check if Bluetooth is enabled
//     const enabled = await isBluetoothEnabled()
//     if (!enabled) {
//       const enableResult = await enableBluetooth()
//       if (!enableResult) {
//         throw new Error("Failed to enable Bluetooth")
//       }
//     }

//     // Start scanning
//     return new Promise((resolve, reject) => {
//       BluetoothManager.scanDevices()
//         .then((devices) => {
//           // Parse the device list string
//           const deviceList =
//             typeof devices === "string"
//               ? JSON.parse(devices.replace(/'/g, '"'))
//               : devices

//           const pairedDevices = deviceList.paired || []
//           const foundDevices = deviceList.found || []

//           // Combine and deduplicate devices
//           const allDevices = [...pairedDevices, ...foundDevices]
//           const uniqueDevices = allDevices.filter(
//             (device, index, self) =>
//               index === self.findIndex((d) => d.address === device.address)
//           )

//           resolve(uniqueDevices)
//         })
//         .catch((error) => {
//           reject(error)
//         })
//     })
//   } catch (error) {
//     console.error("Error scanning for Bluetooth devices:", error)
//     throw error
//   }
// }

// // Connect to a Bluetooth printer
// export const connectToPrinter = async (address: string): Promise<boolean> => {
//   try {
//     // Check permissions first
//     const hasPermissions = await checkBluetoothPermissions()
//     if (!hasPermissions) {
//       const granted = await requestBluetoothPermissions()
//       if (!granted) {
//         throw new Error("Bluetooth permissions not granted")
//       }
//     }
//     await BluetoothManager.connect(address)
//     return true
//   } catch (error) {
//     console.error(`Error connecting to printer ${address}:`, error)
//     return false
//   }
// }

// // Disconnect from a Bluetooth printer
// export const disconnectFromPrinter = async (): Promise<boolean> => {
//   try {
//     await BluetoothManager.disconnect()
//     return true
//   } catch (error) {
//     console.error("Error disconnecting from printer:", error)
//     return false
//   }
// }

// // Check if connected to a printer
// export const isConnectedToPrinter = async (): Promise<boolean> => {
//   try {
//     const status = await BluetoothManager.getConnectedDeviceAddress()
//     return !!status
//   } catch (error) {
//     return false
//   }
// }

// // Print receipt using Bluetooth printer
// export const printReceiptWithBluetooth = async (
//   order: Order
// ): Promise<{ success: boolean; message: string }> => {
//   try {
//     // Check permissions first
//     const hasPermissions = await checkBluetoothPermissions()
//     if (!hasPermissions) {
//       const granted = await requestBluetoothPermissions()
//       if (!granted) {
//         throw new Error("Bluetooth permissions not granted")
//       }
//     }
//     const businessInfo = await getBusinessInfo()
//     const defaultPrinter = await getDefaultPrinter()

//     if (!defaultPrinter || defaultPrinter.type !== "bluetooth") {
//       throw new Error("No default Bluetooth printer configured")
//     }

//     // Connect to the printer
//     const connected = await connectToPrinter(defaultPrinter.address)
//     if (!connected) {
//       throw new Error(`Failed to connect to printer ${defaultPrinter.name}`)
//     }

//     // Print receipt
//     await BluetoothEscposPrinter.printerAlign(
//       BluetoothEscposPrinter.ALIGN.CENTER
//     )
//     await BluetoothEscposPrinter.setBlob(0)
//     await BluetoothEscposPrinter.printText(`${businessInfo.name}\n\r`, {
//       encoding: "GBK",
//       codepage: 0,
//       widthtimes: 1,
//       heigthtimes: 1,
//       fonttype: 1,
//     })

//     await BluetoothEscposPrinter.printText(`${businessInfo.address}\n\r`, {})
//     await BluetoothEscposPrinter.printText(`${businessInfo.phone}\n\r`, {})
//     if (businessInfo.website) {
//       await BluetoothEscposPrinter.printText(`${businessInfo.website}\n\r`, {})
//     }

//     await BluetoothEscposPrinter.printText(
//       `--------------------------------\n\r`,
//       {}
//     )

//     // Order info
//     await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.LEFT)
//     await BluetoothEscposPrinter.printText(
//       `Order #: ${order.tempOrderId}\n\r`,
//       {}
//     )
//     await BluetoothEscposPrinter.printText(
//       `Date: ${new Date(order.createdAt).toLocaleString()}\n\r`,
//       {}
//     )
//     await BluetoothEscposPrinter.printText(
//       `Customer: ${`${order.customerFirstName} ${order.customerLastName}`}\n\r`,
//       {}
//     )
//     await BluetoothEscposPrinter.printText(`Status: ${order.status}\n\r`, {})

//     await BluetoothEscposPrinter.printText(
//       `--------------------------------\n\r`,
//       {}
//     )

//     // Column headers
//     await BluetoothEscposPrinter.printColumn(
//       [30, 8, 12],
//       [
//         BluetoothEscposPrinter.ALIGN.LEFT,
//         BluetoothEscposPrinter.ALIGN.CENTER,
//         BluetoothEscposPrinter.ALIGN.RIGHT,
//       ],
//       ["Item", "Qty", "Price"],
//       {}
//     )

//     await BluetoothEscposPrinter.printText(
//       `--------------------------------\n\r`,
//       {}
//     )

//     // Items
//     for (const item of order.desserts) {
//       const pricePerItem =
//         (item.dessert.priceInCents +
//           item.customisations.reduce((total, customisation) => {
//             return (
//               total +
//               customisation.customisation.priceInCents * customisation.quantity
//             )
//           }, 0)) /
//         100
//       await BluetoothEscposPrinter.printColumn(
//         [30, 8, 12],
//         [
//           BluetoothEscposPrinter.ALIGN.LEFT,
//           BluetoothEscposPrinter.ALIGN.CENTER,
//           BluetoothEscposPrinter.ALIGN.RIGHT,
//         ],
//         [
//           item.dessert.name.substring(0, 29),
//           item.quantity.toString(),
//           `$${((pricePerItem * item.quantity) / 100).toFixed(2)}`,
//         ],
//         {}
//       )

//       // Print customizations if any
//       if (item.customisations && item.customisations.length > 0) {
//         for (const custom of item.customisations) {
//           await BluetoothEscposPrinter.printText(
//             `  • ${custom.customisation.name}: ${custom.quantity}x\n\r`,
//             {}
//           )
//         }
//       }
//     }

//     await BluetoothEscposPrinter.printText(
//       `--------------------------------\n\r`,
//       {}
//     )

//     // Totals
//     await BluetoothEscposPrinter.printColumn(
//       [24, 1, 25],
//       [
//         BluetoothEscposPrinter.ALIGN.LEFT,
//         BluetoothEscposPrinter.ALIGN.CENTER,
//         BluetoothEscposPrinter.ALIGN.RIGHT,
//       ],
//       ["Subtotal", "", `$${(order.priceInCents / 100).toFixed(2)}`],
//       {}
//     )

//     await BluetoothEscposPrinter.printColumn(
//       [24, 1, 25],
//       [
//         BluetoothEscposPrinter.ALIGN.LEFT,
//         BluetoothEscposPrinter.ALIGN.CENTER,
//         BluetoothEscposPrinter.ALIGN.RIGHT,
//       ],
//       ["Tax", "", `$${(order.GST / 100).toFixed(2)}`],
//       {}
//     )

//     await BluetoothEscposPrinter.printText(
//       `--------------------------------\n\r`,
//       {}
//     )

//     // Grand total
//     await BluetoothEscposPrinter.printColumn(
//       [24, 1, 25],
//       [
//         BluetoothEscposPrinter.ALIGN.LEFT,
//         BluetoothEscposPrinter.ALIGN.CENTER,
//         BluetoothEscposPrinter.ALIGN.RIGHT,
//       ],
//       ["TOTAL", "", `$${(order.priceInCents / 100).toFixed(2)}`],
//       {
//         widthtimes: 1,
//         heigthtimes: 1,
//         fonttype: 1,
//       }
//     )

//     // Footer
//     await BluetoothEscposPrinter.printText(`\n\r`, {})
//     await BluetoothEscposPrinter.printerAlign(
//       BluetoothEscposPrinter.ALIGN.CENTER
//     )
//     await BluetoothEscposPrinter.printText(`Thank you for your order!\n\r`, {})

//     // Notes if any
//     if (order.notes) {
//       await BluetoothEscposPrinter.printText(`\n\r`, {})
//       await BluetoothEscposPrinter.printerAlign(
//         BluetoothEscposPrinter.ALIGN.LEFT
//       )
//       await BluetoothEscposPrinter.printText(`Notes: ${order.notes}\n\r`, {})
//     }

//     // Cut paper
//     await BluetoothEscposPrinter.printText(`\n\r\n\r\n\r\n\r`, {})

//     return { success: true, message: "Receipt printed successfully" }
//   } catch (error) {
//     console.error("Error printing receipt with Bluetooth:", error)
//     return { success: false, message: `Failed to print receipt: ${error}` }
//   }
// }

// // Generate HTML for receipt
// const generateReceiptHTML = (
//   order: Order,
//   businessInfo: BusinessInfo
// ): string => {
//   // Create a simple HTML template for the receipt
//   return `
//     <!DOCTYPE html>
//     <html>
//       <head>
//         <meta charset="utf-8">
//         <title>Receipt</title>
//         <style>
//           body {
//             font-family: 'Helvetica Neue', Arial, sans-serif;
//             margin: 0;
//             padding: 20px;
//             max-width: 300px;
//           }
//           .header {
//             text-align: center;
//             margin-bottom: 20px;
//           }
//           .business-name {
//             font-size: 18px;
//             font-weight: bold;
//             margin-bottom: 5px;
//           }
//           .business-info {
//             font-size: 12px;
//             margin-bottom: 3px;
//           }
//           .divider {
//             border-bottom: 1px solid #ddd;
//             margin: 10px 0;
//           }
//           .order-info {
//             margin-bottom: 15px;
//             font-size: 12px;
//           }
//           .order-info p {
//             margin: 3px 0;
//           }
//           .items-header, .item-row {
//             display: flex;
//             justify-content: space-between;
//             font-size: 12px;
//             padding: 5px 0;
//           }
//           .items-header {
//             font-weight: bold;
//           }
//           .item-name {
//             flex: 1;
//           }
//           .item-qty {
//             width: 40px;
//             text-align: center;
//           }
//           .item-price, .item-total {
//             width: 70px;
//             text-align: right;
//           }
//           .customization {
//             font-size: 10px;
//             color: #666;
//             margin-left: 10px;
//           }
//           .totals {
//             margin-top: 10px;
//           }
//           .total-row {
//             display: flex;
//             justify-content: space-between;
//             margin-bottom: 3px;
//           }
//           .total-label {
//             text-align: right;
//           }
//           .total-value {
//             width: 70px;
//             text-align: right;
//             font-weight: 500;
//           }
//           .grand-total {
//             margin-top: 5px;
//             padding-top: 5px;
//             border-top: 1px solid #ddd;
//             font-weight: bold;
//             font-size: 14px;
//           }
//           .footer {
//             margin-top: 20px;
//             text-align: center;
//             font-size: 12px;
//           }
//           .notes {
//             margin-top: 10px;
//             padding-top: 10px;
//             border-top: 1px solid #ddd;
//             font-size: 11px;
//           }
//           .notes-label {
//             font-weight: bold;
//             margin-bottom: 3px;
//           }
//         </style>
//       </head>
//       <body>
//         <div class="header">
//           <div class="business-name">${businessInfo.name}</div>
//           <div class="business-info">${businessInfo.address}</div>
//           <div class="business-info">${businessInfo.phone}</div>
//           ${
//             businessInfo.website
//               ? `<div class="business-info">${businessInfo.website}</div>`
//               : ""
//           }
//           ${
//             businessInfo.taxId
//               ? `<div class="business-info">Tax ID: ${businessInfo.taxId}</div>`
//               : ""
//           }
//         </div>

//         <div class="divider"></div>

//         <div class="order-info">
//           <p>Order #: ${order.tempOrderId}</p>
//           <p>Date: ${new Date(order.createdAt).toLocaleString()}</p>
//           <p>Customer: ${`${order.customerFirstName} ${order.customerLastName}`}</p>
//           <p>Status: ${order.status}</p>
//         </div>

//         <div class="divider"></div>

//         <div class="items-header">
//           <div class="item-name">Item</div>
//           <div class="item-qty">Qty</div>
//           <div class="item-price">Price</div>
//           <div class="item-total">Total</div>
//         </div>

//         <div class="divider"></div>

//         ${order.desserts
//           .map((item) => {
//             const pricePerItem =
//               (item.dessert.priceInCents +
//                 item.customisations.reduce((total, customisation) => {
//                   return (
//                     total +
//                     customisation.customisation.priceInCents *
//                       customisation.quantity
//                   )
//                 }, 0)) /
//               100
//             return `
//           <div class="item-row">
//             <div class="item-name">
//               ${item.dessert.name}
//               ${
//                 item.customisations
//                   ? item.customisations
//                       .map(
//                         (custom) =>
//                           `<div class="customization">• ${custom.customisation.name}: ${custom.quantity}x</div>`
//                       )
//                       .join("")
//                   : ""
//               }
//             </div>
//             <div class="item-qty">${item.quantity}</div>
//             <div class="item-price">$${(pricePerItem / 100).toFixed(2)}</div>
//             <div class="item-total">$${(
//               (pricePerItem / 100) *
//               item.quantity
//             ).toFixed(2)}</div>
//           </div>
//         `
//           })
//           .join("")}

//         <div class="divider"></div>

//         <div class="totals">
//           <div class="total-row">
//             <div class="total-label">Subtotal:</div>
//             <div class="total-value">$${(order.priceInCents / 100).toFixed(
//               2
//             )}</div>
//           </div>
//           <div class="total-row">
//             <div class="total-label">Tax:</div>
//             <div class="total-value">$${(order.GST / 100).toFixed(2)}</div>
//           </div>

//           <div class="total-row grand-total">
//             <div class="total-label">Total:</div>
//             <div class="total-value">$${(order.priceInCents / 100).toFixed(
//               2
//             )}</div>
//           </div>
//         </div>

//         <div class="footer">
//           <p>Thank you for your order!</p>
//           ${
//             order.notes
//               ? `
//           <div class="notes">
//             <div class="notes-label">Notes:</div>
//             <div>${order.notes}</div>
//           </div>
//           `
//               : ""
//           }
//         </div>
//       </body>
//     </html>
//   `
// }

// // Print receipt
// export const printReceipt = async (
//   order: Order
// ): Promise<{ success: boolean; message: string }> => {
//   try {
//     const defaultPrinter = await getDefaultPrinter()

//     // If we have a default Bluetooth printer, use it
//     if (defaultPrinter && defaultPrinter.type === "bluetooth") {
//       return await printReceiptWithBluetooth(order)
//     }

//     // Otherwise fall back to PDF/system printing
//     const businessInfo = await getBusinessInfo()
//     const html = generateReceiptHTML(order, businessInfo)

//     // Use Expo Print to print or save as PDF
//     const { uri } = await Print.printToFileAsync({ html })

//     // On iOS/Android, we can print directly
//     if (Platform.OS === "ios" || Platform.OS === "android") {
//       await Print.printAsync({ uri })
//       return { success: true, message: "Receipt printed successfully" }
//     } else {
//       // On web or other platforms, share the PDF
//       await shareAsync(uri, { UTI: ".pdf", mimeType: "application/pdf" })
//       return { success: true, message: "Receipt saved as PDF" }
//     }
//   } catch (error) {
//     console.error("Error printing receipt:", error)
//     return { success: false, message: `Failed to print receipt: ${error}` }
//   }
// }

// // Save receipt as PDF
// export const saveReceiptAsPDF = async (
//   order: Order
// ): Promise<{ success: boolean; message: string; uri?: string }> => {
//   try {
//     const businessInfo = await getBusinessInfo()
//     const html = generateReceiptHTML(order, businessInfo)

//     // Generate PDF
//     const { uri } = await Print.printToFileAsync({ html })

//     // Create a unique filename
//     const filename = `receipt-${order.tempOrderId}-${new Date().getTime()}.pdf`

//     // On iOS/Android, we can save to document directory
//     if (FileSystem.documentDirectory) {
//       const newUri = FileSystem.documentDirectory + filename
//       await FileSystem.moveAsync({ from: uri, to: newUri })

//       // Share the PDF
//       await shareAsync(newUri, { UTI: ".pdf", mimeType: "application/pdf" })
//       return { success: true, message: "Receipt saved as PDF", uri: newUri }
//     } else {
//       // Just share the original URI
//       await shareAsync(uri, { UTI: ".pdf", mimeType: "application/pdf" })
//       return { success: true, message: "Receipt saved as PDF", uri }
//     }
//   } catch (error) {
//     console.error("Error saving receipt as PDF:", error)
//     return { success: false, message: `Failed to save receipt: ${error}` }
//   }
// }

// // Auto-print receipt when order is accepted
// export const autoPrintOnAccept = async (
//   order: Order
// ): Promise<{ success: boolean; message: string }> => {
//   try {
//     // Check if auto-print is enabled
//     const autoPrintEnabled = await AsyncStorage.getItem("auto_print_enabled")

//     if (autoPrintEnabled === "true") {
//       return await printReceipt(order)
//     }

//     return { success: true, message: "Auto-print is disabled" }
//   } catch (error) {
//     console.error("Error in auto-print:", error)
//     return { success: false, message: `Auto-print error: ${error}` }
//   }
// }

// // [
// //   "react-native-bluetooth-escpos-printer",
// //   {
// //     "bluetoothPermissions": true
// //   }
// // ]
