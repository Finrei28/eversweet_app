import {
  View,
  Text,
  TextInput,
  Alert,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native"
import React, { useState } from "react"
import { useRouter } from "expo-router"
import { createAccount } from "@/services/api"
import OTPInput from "@/_components/emailVerification"
import CustomHeader from "@/_components/custom-header"
import PageHeader from "@/_components/pageheader"
import { parsePhoneNumberFromString } from "libphonenumber-js"
import validator from "validator"

export default function SignUp() {
  const [signupForm, setSignupForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
  })
  const [verifyEmail, setVerifyEmail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const router = useRouter()

  const handleSignUp = async () => {
    if (!signupForm.email || !signupForm.password) {
      Alert.alert("Error", "Please enter both email and password.")
      return
    }
    if (!validator.isEmail(signupForm.email)) {
      Alert.alert("Error", "Please enter a valid email address.")
      return
    }
    const phone = parsePhoneNumberFromString(signupForm.phoneNumber, "NZ")
    if (!phone?.isValid()) {
      Alert.alert("Error", "Please enter a valid phone number")
      return
    }
    if (signupForm.password !== signupForm.confirmPassword) {
      Alert.alert("Error", "Passwords do not match.")
      return
    }
    if (signupForm.password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters long.")
      return
    }
    if (!signupForm.firstName) {
      Alert.alert("Error", "Please enter your name.")
      return
    }
    if (!signupForm.lastName) {
      Alert.alert("Error", "Please enter your name.")
      return
    }
    const signupData = {
      firstName: signupForm.firstName,
      lastName: signupForm.lastName,
      email: signupForm.email,
      phoneNumber: phone.format("E.164"),
      password: signupForm.password,
    }
    try {
      setIsCreating(true)
      await createAccount(signupData)
      setVerifyEmail(true)
    } catch (error) {
      const message = (error as Error).message

      if (message.includes("already registered")) {
        Alert.alert("Email in use", "Please use a different email.")
      } else {
        Alert.alert("Sign-up failed", message || "An unknown error occurred.")
      }
      return
    } finally {
      setIsCreating(false)
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
            {verifyEmail ? (
              <>
                <PageHeader />
                <OTPInput
                  email={signupForm.email}
                  setIsLoading={setLoading}
                  isLoading={loading}
                />
              </>
            ) : (
              <>
                <CustomHeader />
                <Text className="mt-10 text-4xl font-bold text-primary text-center">
                  Sign Up
                </Text>
                <View className="flex-1 justify-center items-center">
                  <View className="w-3/4 mb-4 ">
                    <Text className="text-lg text-gray-500">First name:</Text>

                    <TextInput
                      className="border border-gray-300 rounded-lg p-4"
                      keyboardType="default"
                      value={signupForm.firstName}
                      onChangeText={(text) =>
                        setSignupForm((prev) => ({ ...prev, firstName: text }))
                      }
                    />
                  </View>
                  <View className="w-3/4 mb-4 ">
                    <Text className="text-lg text-gray-500">Last name:</Text>

                    <TextInput
                      className="border border-gray-300 rounded-lg p-4"
                      keyboardType="default"
                      value={signupForm.lastName}
                      onChangeText={(text) =>
                        setSignupForm((prev) => ({ ...prev, lastName: text }))
                      }
                    />
                  </View>
                  <View className="w-3/4 mb-4 ">
                    <Text className="text-lg text-gray-500">Email:</Text>

                    <TextInput
                      className="border border-gray-300 rounded-lg p-4"
                      keyboardType="email-address"
                      value={signupForm.email}
                      onChangeText={(text) =>
                        setSignupForm((prev) => ({ ...prev, email: text }))
                      }
                    />
                  </View>
                  <View className="w-3/4 mb-4">
                    <Text className="text-lg text-gray-500">Phone Number:</Text>

                    <TextInput
                      className="border border-gray-300 rounded-lg p-4"
                      keyboardType="phone-pad"
                      placeholder="+64 21 123 4567"
                      value={signupForm.phoneNumber}
                      onChangeText={(text) =>
                        setSignupForm((prev) => ({
                          ...prev,
                          phoneNumber: text,
                        }))
                      }
                    />
                  </View>
                  <View className="w-3/4 mb-4 ">
                    <Text className="text-lg text-gray-500 ">Password:</Text>
                    <TextInput
                      className="border border-gray-300 rounded-lg p-4"
                      secureTextEntry
                      value={signupForm.password}
                      onChangeText={(text) =>
                        setSignupForm((prev) => ({ ...prev, password: text }))
                      }
                    />
                  </View>
                  <View className="w-3/4 mb-8 ">
                    <Text className="text-lg text-gray-500 ">
                      Confirm password:
                    </Text>
                    <TextInput
                      className="border border-gray-300 rounded-lg p-4"
                      secureTextEntry
                      value={signupForm.confirmPassword}
                      onChangeText={(text) =>
                        setSignupForm((prev) => ({
                          ...prev,
                          confirmPassword: text,
                        }))
                      }
                    />
                  </View>
                  <TouchableOpacity
                    onPress={handleSignUp}
                    className=" mb-10 bg-primary py-3 rounded-lg items-center w-1/2"
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-white text-2xl font-bold">
                        Create Account
                      </Text>
                    )}
                  </TouchableOpacity>
                  <View className="flex-row items-center justify-center">
                    <Text className="text-gray-500 mr-2">
                      Already have an account?
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        router.replace("/signin")
                      }}
                    >
                      <Text className="text-primary text-base font-semibold">
                        Sign in
                      </Text>
                    </TouchableOpacity>
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
