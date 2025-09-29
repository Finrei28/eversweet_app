import {
  View,
  Text,
  TextInput,
  Alert,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native"
import React, { useState } from "react"
import { getResetPasswordCode } from "@/services/api"
import CustomHeader from "@/_components/custom-header"
import Toast from "react-native-toast-message"
import OTPInput from "@/_components/emailVerification"
import ResetPassword from "@/_components/resetPassword"

export default function forgotPassword() {
  const [email, setEmail] = useState("")
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  const handleForgotPassword = async () => {
    if (!email) {
      Toast.show({
        type: "error",
        text1: `Please enter your email.`,
        position: "bottom",
        visibilityTime: 5000,
        autoHide: true,
        bottomOffset: 60,
      })
      return
    }
    if (!isValidEmail(email)) {
      Toast.show({
        type: "error",
        text1: `Please enter a valid email address.`,
        position: "bottom",
        visibilityTime: 5000,
        autoHide: true,
        bottomOffset: 60,
      })
      return
    }
    setIsLoading(true)
    try {
      setIsVerifyingCode(true)
      await getResetPasswordCode(email)
    } catch (error) {
      Alert.alert("Error", (error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <CustomHeader />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          className="bg-background "
        >
          <View className="flex-1 bg-background">
            {isResettingPassword ? (
              <ResetPassword
                email={email}
                setIsLoading={setIsLoading}
                isLoading={isLoading}
              />
            ) : isVerifyingCode ? (
              <OTPInput
                email={email}
                setIsResettingPassword={setIsResettingPassword}
                setIsLoading={setIsLoading}
                isLoading={isLoading}
              />
            ) : (
              <>
                <View className="mt-10">
                  <Text className="text-4xl font-bold text-primary text-center mb-2">
                    Reset Password
                  </Text>
                </View>

                <View className="flex-1 justify-center">
                  <Text className="text-center font-bold text-lg text-primary mb-2 px-10">
                    Enter your email to receive a password reset code.
                  </Text>
                  <View className="items-center">
                    <View className="w-3/4 max-w-md mb-4">
                      <Text className="text-lg text-gray-500 mb-1">Email:</Text>
                      <TextInput
                        className="border border-gray-300 rounded-lg p-4"
                        keyboardType="email-address"
                        value={email}
                        onChangeText={setEmail}
                      />
                    </View>

                    <TouchableOpacity
                      onPress={handleForgotPassword}
                      className="bg-primary py-3 rounded-lg items-center w-1/2 mb-10"
                    >
                      <Text className="text-white text-2xl font-bold">
                        Get Code
                      </Text>
                    </TouchableOpacity>
                    <View className="flex-row items-center justify-center mb-3"></View>
                  </View>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  )
}
