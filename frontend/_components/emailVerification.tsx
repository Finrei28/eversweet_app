"use client"

import React, { useRef, useState } from "react"
import {
  View,
  TextInput,
  Platform,
  ScrollView,
  Text,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Keyboard,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native"
import * as Clipboard from "expo-clipboard"
import PageHeader from "./pageheader"
import { checkVerificationCode, verifyResetPasswordCode } from "@/services/api"
import Toast from "react-native-toast-message"
import { useRouter } from "expo-router"

const OTPInput = ({
  onChange,
  email,
  setIsResettingPassword,
  setIsLoading,
  isLoading,
}: {
  onChange?: (code: string) => void
  email: string
  setIsResettingPassword?: React.Dispatch<React.SetStateAction<boolean>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  isLoading: boolean
}) => {
  const [code, setCode] = useState<string[]>(Array(6).fill(""))
  const inputsRef = useRef<Array<TextInput | null>>([])
  const router = useRouter()
  const handleChange = (value: string, index: number) => {
    if (!/^\d?$/.test(value)) return
    const newCode = [...code]
    newCode[index] = value
    setCode(newCode)
    onChange?.(newCode.join(""))

    if (value && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace") {
      const newCode = [...code]

      if (newCode[index]) {
        // Case 1: current box has a digit → clear it
        newCode[index] = ""
        setCode(newCode)
      } else if (index > 0) {
        // Case 2: current box already empty → move left
        newCode[index - 1] = ""
        setCode(newCode)
        inputsRef.current[index - 1]?.focus()
      }
    }
  }

  const handlePaste = async () => {
    const clipboardContent = await Clipboard.getStringAsync()
    const match = clipboardContent.match(/^\d{6}$/)
    if (match) {
      const digits = clipboardContent.split("")
      setCode(digits)
      onChange?.(digits.join(""))
      inputsRef.current[5]?.focus()
    }
  }

  const handleCodeCheck = async () => {
    try {
      setIsLoading(true)
      if (setIsResettingPassword) {
        const data = await verifyResetPasswordCode(email, code.join(""))
        if (data?.success) {
          setIsResettingPassword(true)
        } else {
          Toast.show({
            type: "error",
            text1: `Could not verify your code`,
            text2:
              "Please try again later, contact eversweet@eversweet.co.nz if problem presists",
            position: "bottom",
            visibilityTime: 5000,
            autoHide: true,
            bottomOffset: 60,
          })
        }
      } else {
        const name = await checkVerificationCode({
          email,
          verificationCode: code.join(""),
        })
        Toast.show({
          type: "success",
          text1: `Welcome aboard ${name.charAt(0).toUpperCase()}${name.slice(
            1
          )}`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
        router.replace("/")
      }
    } catch (error) {
      Alert.alert(`${(error as Error).message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Text className="mt-36 text-4xl font-bold text-primary text-center">
        Verify your email
      </Text>
      <View className="flex-1 justify-between items-center">
        <Text className="text-lg text-gray-500 text-center mt-2">
          Enter the 6-digit code sent to your email
        </Text>
        <View className="flex-col items-center justify-center">
          <View className=" flex-row justify-center items-center gap-1 max-w-[15%] min-h-16">
            {code.map((digit, i) => (
              <TextInput
                key={i}
                ref={(ref) => {
                  inputsRef.current[i] = ref
                }}
                className="w-full h-full text-center flex items-center flex-row text-3xl border-2 border-black rounded-lg"
                keyboardType="number-pad"
                maxLength={1}
                value={digit}
                onChangeText={(value) => handleChange(value, i)}
                onKeyPress={(e) => handleKeyPress(e, i)}
                onFocus={handlePaste}
              />
            ))}
          </View>
          <TouchableOpacity onPress={handleCodeCheck} className="mt-6">
            <Text className="text-primary text-base font-semibold text-center">
              Resend Code
            </Text>
          </TouchableOpacity>
        </View>

        <View className="w-full items-center mb-10">
          <TouchableOpacity
            className="mb-10 w-[80%] rounded-lg bg-secondary p-3"
            onPress={handleCodeCheck}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-primary text-base font-semibold text-center">
                Verify code
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </>
  )
}

export default OTPInput
