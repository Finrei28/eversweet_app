import CustomHeader from "@/components/pageheader"
import { useAuth } from "@/providers/auth-provider"
import { signInAPI } from "@/services/api"
import { useRouter } from "expo-router"
import React, { useState } from "react"
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native"
import Toast from "react-native-toast-message"

export default function signin() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { signIn } = useAuth()
  const router = useRouter()

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert("Error", "Please enter both your email and password.")
      return
    }
    setIsLoading(true)
    try {
      const token = await signInAPI({ username, password })
      setUsername("")
      setPassword("")
      await signIn(token)
      Toast.show({
        type: "success",
        text1: `Welcome back`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    } catch (error) {
      const message = (error as Error).message
      if (message.includes("invalid login credentials")) {
        Alert.alert("Invalid email or password.")
      } else if (message.includes("User not found")) {
        Alert.alert("User not found. Please sign up.")
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
          <View className={Platform.OS === "ios" ? "mt-36" : "mt-28"}>
            <Text className="text-4xl font-bold text-primary text-center mb-2">
              Admin Sign In
            </Text>
          </View>

          <View className="flex-1 justify-center">
            <View className="items-center">
              <View className="w-3/4 max-w-md mb-4">
                <Text className="text-lg text-gray-500 mb-1">Username:</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg p-4"
                  keyboardType="default"
                  value={username}
                  onChangeText={setUsername}
                />
              </View>

              <View className="w-3/4 max-w-md mb-8">
                <Text className="text-lg text-gray-500 mb-1">Password:</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg p-4"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={handleLogin}
                />
              </View>

              <TouchableOpacity
                onPress={handleLogin}
                className="bg-primary py-3 rounded-lg items-center w-1/2 mb-10"
                disabled={isLoading}
              >
                <Text className="text-white text-2xl font-bold">
                  {isLoading ? "Signing in..." : "Sign in"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  )
}
