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
} from "react-native"
import * as Clipboard from "expo-clipboard"
import PageHeader from "./pageheader"
import { checkVerificationCode } from "@/services/api"
import Toast from "react-native-toast-message"
import { useRouter } from "expo-router"

const OTPInput = ({
  onChange,
  email,
}: {
  onChange?: (code: string) => void
  email: string
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
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      const newCode = [...code]
      newCode[index - 1] = ""
      setCode(newCode)
      inputsRef.current[index - 1]?.focus()
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
      const name = await checkVerificationCode({
        email,
        verificationCode: code.join(""),
      })
      Toast.show({
        type: "success",
        text1: `Welcome aboard ${name.charAt(0).toUpperCase()}${name.slice(1)}`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
      router.replace("/")
    } catch (error) {
      Alert.alert(`${(error as Error).message}`)
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 bg-background">
            <PageHeader />
            <Text className="mt-36 text-4xl font-bold text-primary pt-5 text-center">
              Verify your email
            </Text>
            <View className="flex-1 justify-between items-center">
              <Text className="text-lg text-gray-500 text-center mt-2">
                Enter the 6-digit code sent to your email
              </Text>
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
                    onFocus={() => {
                      const firstEmptyIndex = code.findIndex((c) => c === "")
                      const targetIndex =
                        firstEmptyIndex === -1 ? 5 : firstEmptyIndex
                      inputsRef.current[targetIndex]?.focus()
                      if (Platform.OS === "android") handlePaste()
                    }}
                  />
                ))}
              </View>
              <View className="w-full flex justify-end items-end">
                <TouchableOpacity
                  className=" mb-10 w-full"
                  onPress={handleCodeCheck}
                >
                  <Text className=" text-primary text-base font-semibold text-center p-3 bg-secondary">
                    Submit
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity className="w-full mb-10">
                  <Text className=" text-primary text-base font-semibold text-center p-3 bg-secondary">
                    Resend code
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  )
}

export default OTPInput
