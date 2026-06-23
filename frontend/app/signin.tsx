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
import { useRouter, useLocalSearchParams } from "expo-router"
import { signIn } from "@/services/api"
import CustomHeader from "@/_components/custom-header"
import Toast from "react-native-toast-message"
import { useAuth } from "@/store/authProvider"
import { Ionicons } from "@expo/vector-icons"

export default function signin() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { redirectTo } = useLocalSearchParams()
  const router = useRouter()
  const { signInProvider } = useAuth()

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter both your email and password.")
      return
    }
    setIsLoading(true)
    try {
      const name = await signIn({ email, password }, signInProvider)
      setEmail("")
      setPassword("")
      Toast.show({
        type: "success",
        text1: `Welcome back ${name.charAt(0).toUpperCase()}${name.slice(1)}`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 90,
        props: {
          text1NumberOfLines: 0,
          text2NumberOfLines: 0, // allow wrapping
        },
      })
      const redirectPath = Array.isArray(redirectTo)
        ? redirectTo[0]
        : redirectTo
      if (redirectPath) {
        router.replace(
          redirectPath as typeof router.replace extends (path: infer P) => any
            ? P
            : never,
        )
      } else {
        router.replace("/") // fallback
      }
    } catch (error) {
      const message = (error as Error).message
      if (message.includes("invalid login credentials")) {
        Alert.alert("Error", "Invalid email or password.")
      } else if (message.includes("User not found")) {
        Alert.alert("Error", "User not found. Please sign up.")
      } else {
        Alert.alert("Error", (error as Error).message)
      }
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
          className="bg-background"
        >
          <View className="mt-10">
            <Text className="text-4xl font-bold text-primary text-center">
              Sign In
            </Text>
          </View>

          <View className="flex-1 justify-center">
            <Text className="text-center font-bold text-lg text-primary mb-2 px-10">
              Sign in to start ordering and earning points!
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

              <View className="w-3/4 max-w-md mb-8">
                <Text className="text-lg text-gray-500 mb-1">Password:</Text>

                <View className="relative">
                  <TextInput
                    className="border border-gray-300 rounded-lg p-4 pr-12"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={handleLogin}
                  />

                  <TouchableOpacity
                    className="absolute right-4 top-0 bottom-0 justify-center"
                    onPress={() => setShowPassword((prev) => !prev)}
                  >
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={22}
                      color="gray"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                onPress={handleLogin}
                className="bg-primary py-3 rounded-lg items-center w-1/2 mb-10"
              >
                <Text className="text-white text-2xl font-bold">
                  {isLoading ? "Signing in..." : "Sign in"}
                </Text>
              </TouchableOpacity>
              <View className="flex-row items-center justify-center mb-3">
                <Text className="text-gray-500 mr-2">
                  Forgot your password?
                </Text>
                <TouchableOpacity
                  onPress={() => router.push("/routers/forgotPassword")}
                >
                  <Text className="text-primary text-base font-semibold">
                    Reset Password
                  </Text>
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center justify-center">
                <Text className="text-gray-500 mr-2">
                  Don't have an account?
                </Text>
                <TouchableOpacity onPress={() => router.replace("/signup")}>
                  <Text className="text-primary text-base font-semibold">
                    Create account
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
