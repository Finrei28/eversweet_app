"use client"

import {
  View,
  Text,
  TextInput,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native"
import React, { useState } from "react"
import { useRouter } from "expo-router"
import { resetPassword } from "@/services/api"
import Toast from "react-native-toast-message"

export default function ResetPassword({
  email,
  setIsLoading,
  isLoading,
}: {
  email: string
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  isLoading: boolean
}) {
  const [changePasswordForm, setChangePasswordForm] = useState({
    newPassword: "",
    confirmNewPassword: "",
  })
  const router = useRouter()

  const handleChangePassword = async () => {
    setIsLoading(true)
    if (!changePasswordForm.newPassword) {
      Alert.alert("Error", "Enter a new password")
      return
    }
    if (
      changePasswordForm.newPassword !== changePasswordForm.confirmNewPassword
    ) {
      Alert.alert("Error", "Passwords do not match.")
      return
    }
    if (changePasswordForm.newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters long.")
      return
    }
    const signupData = {
      password: changePasswordForm.newPassword,
    }
    try {
      const data = await resetPassword(email, signupData.password)
      if (data?.success) {
        Toast.show({
          type: "success",
          text1: `Password has been changed`,
          text2: `Please log in with your new password.`,
          position: "bottom",
          visibilityTime: 5000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
        router.replace("/signin")
      } else {
        Toast.show({
          type: "error",
          text1: `Password could not be changed`,
          text2: `Please contact eversweet@eversweet.co.nz to reset your password.`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      }
    } catch (error) {
      Alert.alert(
        "Could not reset your password",
        error instanceof Error ? error.message : "An unknown error occurred.",
      )

      return
    } finally {
      setIsLoading(false)
    }
  }
  return (
    <>
      <Text className="mt-10 text-4xl font-bold text-primary text-center">
        Set new password
      </Text>
      <View className="flex-1 justify-center items-center">
        <View className="w-3/4 mb-4 ">
          <Text className="text-lg text-gray-500 ">New Password:</Text>
          <TextInput
            className="border border-gray-300 rounded-lg p-4"
            secureTextEntry
            value={changePasswordForm.newPassword}
            onChangeText={(text) =>
              setChangePasswordForm((prev) => ({ ...prev, newPassword: text }))
            }
          />
        </View>
        <View className="w-3/4 mb-8 ">
          <Text className="text-lg text-gray-500 ">Confirm password:</Text>
          <TextInput
            className="border border-gray-300 rounded-lg p-4"
            secureTextEntry
            value={changePasswordForm.confirmNewPassword}
            onChangeText={(text) =>
              setChangePasswordForm((prev) => ({
                ...prev,
                confirmNewPassword: text,
              }))
            }
          />
        </View>
        <TouchableOpacity
          onPress={handleChangePassword}
          className=" mb-10 bg-primary py-3 rounded-lg items-center w-1/2"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-white text-2xl font-bold">
              Change Password
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  )
}
