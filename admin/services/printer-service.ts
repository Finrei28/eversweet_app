import { Order } from "@/lib/types"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useState } from "react"
import thermalPrinter from "./thermal-printer"

export default function usePrintReceipt() {
  const [isPrinting, setIsPrinting] = useState(false)
  const handlePrintReceipt = async (order: Order) => {
    setIsPrinting(true)
    try {
      const autoPrintEnabled = await AsyncStorage.getItem("auto_print_enabled")
      if (autoPrintEnabled === "true") {
        const defaultPrinter = await thermalPrinter.getDefaultPrinter()
        if (defaultPrinter) {
          const connected = await thermalPrinter.connectToPrinter(
            defaultPrinter.id
          )
          if (connected) {
            const printResult = await thermalPrinter.printReceipt(order)
            if (!printResult.success) {
              console.warn("Auto-print failed:", printResult.message)
            }
          } else {
            console.warn("Failed to connect to default printer for auto-print")
          }
        } else {
          console.warn("No default printer set for auto-print")
        }
      }
    } catch (error) {
      console.error("Error in auto-print:", error)
    } finally {
      setIsPrinting(false)
    }
  }

  return { isPrinting, setIsPrinting, handlePrintReceipt }
}
