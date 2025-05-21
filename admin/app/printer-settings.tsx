// "use client"

// import {
//   deletePrinter,
//   getBusinessInfo,
//   getPrinters,
//   isBluetoothEnabled,
//   saveBusinessInfo,
//   savePrinter,
//   setDefaultPrinter,
//   type BusinessInfo,
//   type Printer,
// } from "@/services/printer-service"
// import { Ionicons } from "@expo/vector-icons"
// import AsyncStorage from "@react-native-async-storage/async-storage"
// import { useRouter } from "expo-router"
// import { useEffect, useState } from "react"
// import {
//   ActivityIndicator,
//   Alert,
//   ScrollView,
//   Switch,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   View,
// } from "react-native"

// export default function PrinterSettings() {
//   const router = useRouter()
//   const [printers, setPrinters] = useState<Printer[]>([])
//   const [loading, setLoading] = useState(true)
//   const [showAddPrinter, setShowAddPrinter] = useState(false)
//   const [showBusinessInfo, setShowBusinessInfo] = useState(false)
//   const [autoPrintEnabled, setAutoPrintEnabled] = useState(false)
//   const [bluetoothEnabled, setBluetoothEnabled] = useState(false)

//   // New printer form state
//   const [newPrinter, setNewPrinter] = useState<Printer>({
//     id: Date.now().toString(),
//     name: "",
//     type: "network",
//     address: "",
//     port: 9100,
//     defaultPrinter: false,
//   })

//   // Business info state
//   const [businessInfo, setBusinessInfo] = useState<BusinessInfo>({
//     name: "",
//     address: "",
//     phone: "",
//     website: "",
//     taxId: "",
//   })

//   useEffect(() => {
//     loadData()
//     checkBluetoothStatus()
//   }, [])

//   const loadData = async () => {
//     setLoading(true)
//     try {
//       // Load printers
//       const savedPrinters = await getPrinters()
//       setPrinters(savedPrinters)

//       // Load business info
//       const info = await getBusinessInfo()
//       setBusinessInfo(info)

//       // Load auto-print setting
//       const autoPrint = await AsyncStorage.getItem("auto_print_enabled")
//       setAutoPrintEnabled(autoPrint === "true")
//     } catch (error) {
//       console.error("Error loading printer data:", error)
//       Alert.alert("Error", "Failed to load printer settings")
//     } finally {
//       setLoading(false)
//     }
//   }

//   const checkBluetoothStatus = async () => {
//     try {
//       const enabled = await isBluetoothEnabled()
//       setBluetoothEnabled(enabled)
//     } catch (error) {
//       console.error("Error checking Bluetooth status:", error)
//     }
//   }

//   const handleAddPrinter = async () => {
//     if (!newPrinter.name || !newPrinter.address) {
//       Alert.alert("Error", "Printer name and address are required")
//       return
//     }

//     try {
//       // If this is the first printer, make it default
//       if (printers.length === 0) {
//         newPrinter.defaultPrinter = true
//       }

//       const success = await savePrinter(newPrinter)
//       if (success) {
//         // Reset form and refresh list
//         setNewPrinter({
//           id: Date.now().toString(),
//           name: "",
//           type: "network",
//           address: "",
//           port: 9100,
//           defaultPrinter: false,
//         })
//         setShowAddPrinter(false)
//         loadData()
//       } else {
//         Alert.alert("Error", "Failed to save printer")
//       }
//     } catch (error) {
//       console.error("Error adding printer:", error)
//       Alert.alert("Error", "Failed to add printer")
//     }
//   }

//   const handleDeletePrinter = async (printerId: string) => {
//     Alert.alert(
//       "Delete Printer",
//       "Are you sure you want to delete this printer?",
//       [
//         {
//           text: "Cancel",
//           style: "cancel",
//         },
//         {
//           text: "Delete",
//           style: "destructive",
//           onPress: async () => {
//             try {
//               const success = await deletePrinter(printerId)
//               if (success) {
//                 loadData()
//               } else {
//                 Alert.alert("Error", "Failed to delete printer")
//               }
//             } catch (error) {
//               console.error("Error deleting printer:", error)
//               Alert.alert("Error", "Failed to delete printer")
//             }
//           },
//         },
//       ]
//     )
//   }

//   const handleSetDefaultPrinter = async (printerId: string) => {
//     try {
//       const success = await setDefaultPrinter(printerId)
//       if (success) {
//         loadData()
//       } else {
//         Alert.alert("Error", "Failed to set default printer")
//       }
//     } catch (error) {
//       console.error("Error setting default printer:", error)
//       Alert.alert("Error", "Failed to set default printer")
//     }
//   }

//   const handleSaveBusinessInfo = async () => {
//     if (!businessInfo.name || !businessInfo.address || !businessInfo.phone) {
//       Alert.alert("Error", "Business name, address, and phone are required")
//       return
//     }

//     try {
//       const success = await saveBusinessInfo(businessInfo)
//       if (success) {
//         setShowBusinessInfo(false)
//         Alert.alert("Success", "Business information saved")
//       } else {
//         Alert.alert("Error", "Failed to save business information")
//       }
//     } catch (error) {
//       console.error("Error saving business info:", error)
//       Alert.alert("Error", "Failed to save business information")
//     }
//   }

//   const handleToggleAutoPrint = async (value: boolean) => {
//     try {
//       await AsyncStorage.setItem("auto_print_enabled", value ? "true" : "false")
//       setAutoPrintEnabled(value)
//     } catch (error) {
//       console.error("Error saving auto-print setting:", error)
//       Alert.alert("Error", "Failed to save auto-print setting")
//     }
//   }

//   const navigateToBluetoothSetup = () => {
//     router.push("/bluetooth-printer-setup")
//   }

//   const navigateToPrinterTest = () => {
//     router.push("/printer-test")
//   }

//   if (loading) {
//     return (
//       <View className="flex-1 items-center justify-center bg-gray-50">
//         <ActivityIndicator size="large" color="#6366F1" />
//       </View>
//     )
//   }

//   return (
//     <>
//       <ScrollView className="flex-1 bg-gray-50 px-4 py-6">
//         {/* Auto-Print Setting */}
//         <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
//           <Text className="text-lg font-semibold mb-4">Receipt Printing</Text>

//           <View className="flex-row items-center justify-between">
//             <View>
//               <Text className="font-medium">Auto-Print on Accept</Text>
//               <Text className="text-gray-500 text-sm">
//                 Automatically print receipt when order is accepted
//               </Text>
//             </View>
//             <Switch
//               value={autoPrintEnabled}
//               onValueChange={handleToggleAutoPrint}
//               trackColor={{ false: "#D1D5DB", true: "#C7D2FE" }}
//               thumbColor={autoPrintEnabled ? "#6366F1" : "#F9FAFB"}
//             />
//           </View>
//         </View>

//         {/* Bluetooth Printer Setup */}
//         <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
//           <Text className="text-lg font-semibold mb-4">Bluetooth Printer</Text>

//           <View className="flex-row items-center mb-4">
//             <View className="w-10 h-10 bg-indigo-100 rounded-full items-center justify-center mr-3">
//               <Ionicons name="bluetooth" size={20} color="#6366F1" />
//             </View>
//             <View className="flex-1">
//               <Text className="font-medium">Bluetooth Status</Text>
//               <Text className="text-gray-500 text-sm">
//                 {bluetoothEnabled
//                   ? "Bluetooth is enabled"
//                   : "Bluetooth is disabled"}
//               </Text>
//             </View>
//             <View
//               className={`px-2 py-1 rounded-full ${
//                 bluetoothEnabled ? "bg-green-100" : "bg-red-100"
//               }`}
//             >
//               <Text
//                 className={`text-xs ${
//                   bluetoothEnabled ? "text-green-800" : "text-red-800"
//                 }`}
//               >
//                 {bluetoothEnabled ? "ON" : "OFF"}
//               </Text>
//             </View>
//           </View>

//           <TouchableOpacity
//             className="bg-indigo-600 py-3 rounded-lg items-center mb-3"
//             onPress={navigateToBluetoothSetup}
//           >
//             <Text className="text-white font-medium">
//               Set Up Bluetooth Printer
//             </Text>
//           </TouchableOpacity>

//           <TouchableOpacity
//             className="border border-indigo-600 py-3 rounded-lg items-center"
//             onPress={navigateToPrinterTest}
//           >
//             <Text className="text-indigo-600 font-medium">Test Printer</Text>
//           </TouchableOpacity>
//         </View>

//         {/* Business Information */}
//         <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
//           <View className="flex-row justify-between items-center mb-4">
//             <Text className="text-lg font-semibold">Business Information</Text>
//             <TouchableOpacity
//               onPress={() => setShowBusinessInfo(!showBusinessInfo)}
//             >
//               <Ionicons
//                 name={showBusinessInfo ? "chevron-up" : "chevron-down"}
//                 size={24}
//                 color="#6B7280"
//               />
//             </TouchableOpacity>
//           </View>

//           {!showBusinessInfo ? (
//             <View>
//               <Text className="font-medium">{businessInfo.name}</Text>
//               <Text className="text-gray-500">{businessInfo.address}</Text>
//               <Text className="text-gray-500">{businessInfo.phone}</Text>
//             </View>
//           ) : (
//             <View>
//               <View className="mb-4">
//                 <Text className="text-gray-700 mb-1">Business Name</Text>
//                 <TextInput
//                   className="border border-gray-300 rounded-lg p-2 bg-white"
//                   value={businessInfo.name}
//                   onChangeText={(text) =>
//                     setBusinessInfo({ ...businessInfo, name: text })
//                   }
//                   placeholder="Business Name"
//                 />
//               </View>

//               <View className="mb-4">
//                 <Text className="text-gray-700 mb-1">Address</Text>
//                 <TextInput
//                   className="border border-gray-300 rounded-lg p-2 bg-white"
//                   value={businessInfo.address}
//                   onChangeText={(text) =>
//                     setBusinessInfo({ ...businessInfo, address: text })
//                   }
//                   placeholder="Address"
//                   multiline
//                 />
//               </View>

//               <View className="mb-4">
//                 <Text className="text-gray-700 mb-1">Phone</Text>
//                 <TextInput
//                   className="border border-gray-300 rounded-lg p-2 bg-white"
//                   value={businessInfo.phone}
//                   onChangeText={(text) =>
//                     setBusinessInfo({ ...businessInfo, phone: text })
//                   }
//                   placeholder="Phone"
//                   keyboardType="phone-pad"
//                 />
//               </View>

//               <View className="mb-4">
//                 <Text className="text-gray-700 mb-1">Website (Optional)</Text>
//                 <TextInput
//                   className="border border-gray-300 rounded-lg p-2 bg-white"
//                   value={businessInfo.website}
//                   onChangeText={(text) =>
//                     setBusinessInfo({ ...businessInfo, website: text })
//                   }
//                   placeholder="Website"
//                   keyboardType="url"
//                 />
//               </View>

//               <View className="mb-4">
//                 <Text className="text-gray-700 mb-1">Tax ID (Optional)</Text>
//                 <TextInput
//                   className="border border-gray-300 rounded-lg p-2 bg-white"
//                   value={businessInfo.taxId}
//                   onChangeText={(text) =>
//                     setBusinessInfo({ ...businessInfo, taxId: text })
//                   }
//                   placeholder="Tax ID"
//                 />
//               </View>

//               <TouchableOpacity
//                 className="bg-indigo-600 py-3 rounded-lg items-center mt-2"
//                 onPress={handleSaveBusinessInfo}
//               >
//                 <Text className="text-white font-medium">
//                   Save Business Information
//                 </Text>
//               </TouchableOpacity>
//             </View>
//           )}
//         </View>

//         {/* Network Printers List */}
//         <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
//           <View className="flex-row justify-between items-center mb-4">
//             <Text className="text-lg font-semibold">Network Printers</Text>
//             <TouchableOpacity
//               onPress={() => setShowAddPrinter(!showAddPrinter)}
//               className="bg-indigo-100 p-2 rounded-full"
//             >
//               <Ionicons
//                 name={showAddPrinter ? "close" : "add"}
//                 size={20}
//                 color="#6366F1"
//               />
//             </TouchableOpacity>
//           </View>

//           {printers.filter((p) => p.type === "network").length === 0 &&
//           !showAddPrinter ? (
//             <View className="items-center py-6">
//               <Ionicons name="print-outline" size={48} color="#D1D5DB" />
//               <Text className="text-gray-500 mt-2 mb-4">
//                 No network printers added yet
//               </Text>
//               <TouchableOpacity
//                 className="bg-indigo-600 px-4 py-2 rounded-lg"
//                 onPress={() => setShowAddPrinter(true)}
//               >
//                 <Text className="text-white font-medium">
//                   Add Network Printer
//                 </Text>
//               </TouchableOpacity>
//             </View>
//           ) : (
//             <>
//               {/* Add Printer Form */}
//               {showAddPrinter && (
//                 <View className="bg-gray-50 p-4 rounded-lg mb-4">
//                   <Text className="font-medium mb-4">
//                     Add New Network Printer
//                   </Text>

//                   <View className="mb-4">
//                     <Text className="text-gray-700 mb-1">Printer Name</Text>
//                     <TextInput
//                       className="border border-gray-300 rounded-lg p-2 bg-white"
//                       value={newPrinter.name}
//                       onChangeText={(text) =>
//                         setNewPrinter({ ...newPrinter, name: text })
//                       }
//                       placeholder="Kitchen Printer"
//                     />
//                   </View>

//                   <View className="mb-4">
//                     <Text className="text-gray-700 mb-1">IP Address</Text>
//                     <TextInput
//                       className="border border-gray-300 rounded-lg p-2 bg-white"
//                       value={newPrinter.address}
//                       onChangeText={(text) =>
//                         setNewPrinter({ ...newPrinter, address: text })
//                       }
//                       placeholder="192.168.1.100"
//                       keyboardType="numeric"
//                     />
//                   </View>

//                   <View className="mb-4">
//                     <Text className="text-gray-700 mb-1">Port</Text>
//                     <TextInput
//                       className="border border-gray-300 rounded-lg p-2 bg-white"
//                       value={newPrinter.port?.toString() || "9100"}
//                       onChangeText={(text) =>
//                         setNewPrinter({
//                           ...newPrinter,
//                           port: Number.parseInt(text) || 9100,
//                         })
//                       }
//                       placeholder="9100"
//                       keyboardType="number-pad"
//                     />
//                   </View>

//                   <View className="flex-row items-center mb-4">
//                     <Text className="text-gray-700 flex-1">
//                       Set as Default Printer
//                     </Text>
//                     <Switch
//                       value={newPrinter.defaultPrinter}
//                       onValueChange={(value) =>
//                         setNewPrinter({ ...newPrinter, defaultPrinter: value })
//                       }
//                       trackColor={{ false: "#D1D5DB", true: "#C7D2FE" }}
//                       thumbColor={
//                         newPrinter.defaultPrinter ? "#6366F1" : "#F9FAFB"
//                       }
//                     />
//                   </View>

//                   <View className="flex-row">
//                     <TouchableOpacity
//                       className="flex-1 bg-gray-300 py-2 rounded-lg items-center mr-2"
//                       onPress={() => {
//                         setShowAddPrinter(false)
//                         setNewPrinter({
//                           id: Date.now().toString(),
//                           name: "",
//                           type: "network",
//                           address: "",
//                           port: 9100,
//                           defaultPrinter: false,
//                         })
//                       }}
//                     >
//                       <Text className="font-medium">Cancel</Text>
//                     </TouchableOpacity>

//                     <TouchableOpacity
//                       className="flex-1 bg-indigo-600 py-2 rounded-lg items-center ml-2"
//                       onPress={handleAddPrinter}
//                     >
//                       <Text className="text-white font-medium">
//                         Add Printer
//                       </Text>
//                     </TouchableOpacity>
//                   </View>
//                 </View>
//               )}

//               {/* Network Printers List */}
//               {printers
//                 .filter((p) => p.type === "network")
//                 .map((printer) => (
//                   <View
//                     key={printer.id}
//                     className="border border-gray-200 rounded-lg p-4 mb-3 bg-gray-50"
//                   >
//                     <View className="flex-row justify-between items-start">
//                       <View className="flex-1">
//                         <View className="flex-row items-center">
//                           <Text className="font-medium text-lg">
//                             {printer.name}
//                           </Text>
//                           {printer.defaultPrinter && (
//                             <View className="ml-2 bg-green-100 px-2 py-0.5 rounded">
//                               <Text className="text-green-800 text-xs">
//                                 Default
//                               </Text>
//                             </View>
//                           )}
//                         </View>

//                         <Text className="text-gray-500 mt-1">
//                           {printer.address}:{printer.port}
//                         </Text>
//                       </View>

//                       <View className="flex-row">
//                         {!printer.defaultPrinter && (
//                           <TouchableOpacity
//                             className="mr-3"
//                             onPress={() => handleSetDefaultPrinter(printer.id)}
//                           >
//                             <Ionicons
//                               name="star-outline"
//                               size={22}
//                               color="#6366F1"
//                             />
//                           </TouchableOpacity>
//                         )}

//                         <TouchableOpacity
//                           onPress={() => handleDeletePrinter(printer.id)}
//                         >
//                           <Ionicons
//                             name="trash-outline"
//                             size={22}
//                             color="#EF4444"
//                           />
//                         </TouchableOpacity>
//                       </View>
//                     </View>
//                   </View>
//                 ))}
//             </>
//           )}
//         </View>
//       </ScrollView>
//     </>
//   )
// }
