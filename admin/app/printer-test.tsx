"use client"

import thermalPrinter from "@/services/thermal-printer"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

export default function PrinterTest() {
  const navigation = useNavigation()
  const [isPrinting, setIsPrinting] = useState(false)
  const [connectedPrinter, setConnectedPrinter] = useState<any>(null)
  const [testResults, setTestResults] = useState<{
    text: boolean | null
    formatting: boolean | null
    characters: boolean | null
  }>({
    text: null,
    formatting: null,
    characters: null,
  })

  useEffect(() => {
    const printer = thermalPrinter.getConnectedPrinter()
    setConnectedPrinter(printer)

    if (!printer) {
      Alert.alert(
        "No Printer Connected",
        "Please connect to a printer first.",
        [
          {
            text: "OK",
            onPress: () => navigation.goBack(),
          },
        ]
      )
    }
  }, [])

  const runBasicTest = async () => {
    setIsPrinting(true)
    setTestResults({
      text: null,
      formatting: null,
      characters: null,
    })

    try {
      const result = await thermalPrinter.printTestPage()

      if (result.success) {
        setTestResults({
          text: true,
          formatting: true,
          characters: true,
        })

        Alert.alert(
          "Test Successful",
          "The printer test was successful. Please check the printed output.",
          [{ text: "OK" }]
        )
      } else {
        setTestResults({
          text: false,
          formatting: false,
          characters: false,
        })

        Alert.alert(
          "Test Failed",
          `The printer test failed: ${result.message}`,
          [{ text: "OK" }]
        )
      }
    } catch (error) {
      console.error("Error running printer test:", error)

      setTestResults({
        text: false,
        formatting: false,
        characters: false,
      })

      Alert.alert(
        "Test Error",
        "An error occurred while testing the printer. Please try again.",
        [{ text: "OK" }]
      )
    } finally {
      setIsPrinting(false)
    }
  }

  const disconnectPrinter = async () => {
    try {
      await thermalPrinter.disconnectPrinter()
      navigation.goBack()
    } catch (error) {
      console.error("Error disconnecting printer:", error)
      Alert.alert(
        "Disconnect Error",
        "An error occurred while disconnecting the printer.",
        [{ text: "OK" }]
      )
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Printer Test</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Printer Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connected Printer</Text>
          {connectedPrinter ? (
            <View style={styles.printerInfo}>
              <Text style={styles.printerName}>
                {connectedPrinter.name || "Unknown Printer"}
              </Text>
              <Text style={styles.printerId}>{connectedPrinter.id}</Text>
              <View style={styles.connectedBadge}>
                <Text style={styles.connectedText}>Connected</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.emptyText}>No printer connected</Text>
          )}
        </View>

        {/* Test Options */}
        {connectedPrinter && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Test Options</Text>
            <Text style={styles.testDescription}>
              Run a comprehensive test to verify your printer is working
              correctly. This will print a test page with various formatting
              options.
            </Text>

            <TouchableOpacity
              style={styles.testButton}
              onPress={runBasicTest}
              disabled={isPrinting}
            >
              {isPrinting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.testButtonText}>Run Printer Test</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Test Results */}
        {(testResults.text !== null ||
          testResults.formatting !== null ||
          testResults.characters !== null) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Test Results</Text>

            <View style={styles.resultItem}>
              <Text style={styles.resultLabel}>Basic Text Printing:</Text>
              {testResults.text === null ? (
                <Text style={styles.resultPending}>Pending</Text>
              ) : testResults.text ? (
                <View style={styles.resultSuccess}>
                  <Ionicons name="checkmark-circle" size={20} color="#4caf50" />
                  <Text style={styles.resultSuccessText}>Success</Text>
                </View>
              ) : (
                <View style={styles.resultFailure}>
                  <Ionicons name="close-circle" size={20} color="#f44336" />
                  <Text style={styles.resultFailureText}>Failed</Text>
                </View>
              )}
            </View>

            <View style={styles.resultItem}>
              <Text style={styles.resultLabel}>Text Formatting:</Text>
              {testResults.formatting === null ? (
                <Text style={styles.resultPending}>Pending</Text>
              ) : testResults.formatting ? (
                <View style={styles.resultSuccess}>
                  <Ionicons name="checkmark-circle" size={20} color="#4caf50" />
                  <Text style={styles.resultSuccessText}>Success</Text>
                </View>
              ) : (
                <View style={styles.resultFailure}>
                  <Ionicons name="close-circle" size={20} color="#f44336" />
                  <Text style={styles.resultFailureText}>Failed</Text>
                </View>
              )}
            </View>

            <View style={styles.resultItem}>
              <Text style={styles.resultLabel}>Special Characters:</Text>
              {testResults.characters === null ? (
                <Text style={styles.resultPending}>Pending</Text>
              ) : testResults.characters ? (
                <View style={styles.resultSuccess}>
                  <Ionicons name="checkmark-circle" size={20} color="#4caf50" />
                  <Text style={styles.resultSuccessText}>Success</Text>
                </View>
              ) : (
                <View style={styles.resultFailure}>
                  <Ionicons name="close-circle" size={20} color="#f44336" />
                  <Text style={styles.resultFailureText}>Failed</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Troubleshooting */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Troubleshooting</Text>
          <View style={styles.troubleshootingItem}>
            <Text style={styles.troubleshootingTitle}>
              Printer not responding?
            </Text>
            <Text style={styles.troubleshootingText}>
              • Make sure the printer is turned on and has paper
            </Text>
            <Text style={styles.troubleshootingText}>
              • Check that the printer is in range (within 10 meters)
            </Text>
            <Text style={styles.troubleshootingText}>
              • Try turning the printer off and on again
            </Text>
            <Text style={styles.troubleshootingText}>
              • Ensure the printer is fully charged or plugged in
            </Text>
          </View>

          <View style={styles.troubleshootingItem}>
            <Text style={styles.troubleshootingTitle}>
              Print quality issues?
            </Text>
            <Text style={styles.troubleshootingText}>
              • Check if the printer head is clean
            </Text>
            <Text style={styles.troubleshootingText}>
              • Make sure you're using the recommended paper type
            </Text>
            <Text style={styles.troubleshootingText}>
              • Some printers may not support all formatting options
            </Text>
          </View>
        </View>

        {/* Disconnect Button */}
        {connectedPrinter && (
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={disconnectPrinter}
          >
            <Text style={styles.disconnectButtonText}>Disconnect Printer</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
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
  content: {
    padding: 16,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  printerInfo: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
  },
  printerName: {
    fontSize: 16,
    fontWeight: "500",
  },
  printerId: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
  },
  connectedBadge: {
    backgroundColor: "#e8f5e9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  connectedText: {
    color: "#4caf50",
    fontSize: 10,
    fontWeight: "600",
  },
  emptyText: {
    color: "#999",
    textAlign: "center",
    marginVertical: 16,
  },
  testDescription: {
    color: "#666",
    marginBottom: 16,
  },
  testButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  testButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  resultItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  resultLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  resultPending: {
    color: "#ff9800",
    fontWeight: "500",
  },
  resultSuccess: {
    flexDirection: "row",
    alignItems: "center",
  },
  resultSuccessText: {
    color: "#4caf50",
    fontWeight: "500",
    marginLeft: 4,
  },
  resultFailure: {
    flexDirection: "row",
    alignItems: "center",
  },
  resultFailureText: {
    color: "#f44336",
    fontWeight: "500",
    marginLeft: 4,
  },
  troubleshootingItem: {
    marginBottom: 16,
  },
  troubleshootingTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  troubleshootingText: {
    color: "#666",
    marginBottom: 4,
  },
  disconnectButton: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  disconnectButtonText: {
    color: "#f44336",
    fontWeight: "500",
  },
})
