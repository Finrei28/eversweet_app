import React, { useState, useEffect } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from "react-native"
import { useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import useFetch from "@/services/use_fetch"
import { getUserProfile, updateUserProfile } from "@/services/api"
import { useAuth } from "@/store/authProvider"

export default function AccountDetails() {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const { token, loading: loadingToken } = useAuth()

  // Form state
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  })

  const {
    data: userProfile,
    loading: profileLoading,
    refetch: refetchProfile,
  } = useFetch(getUserProfile)

  useEffect(() => {
    if (!loadingToken && !token) {
      router.push("/signin")
    }
  }, [token, loadingToken])

  useEffect(() => {
    if (userProfile) {
      setFormData({
        firstName: userProfile.firstName || "",
        lastName: userProfile.lastName || "",
        email: userProfile.email || "",
        phone: userProfile.phone || "",
      })
    }
  }, [userProfile])

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleSave = async () => {
    try {
      // Call API to update profile
      await updateUserProfile(formData)
      setIsEditing(false)
      refetchProfile()
    } catch (error) {
      console.error("Failed to update profile:", error)
    }
  }

  if (loadingToken || profileLoading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  if (!token) {
    router.replace("/")
    return null
  }

  const FormField = ({
    label,
    value,
    field,
    editable = true,
  }: {
    label: string
    value: string
    field: string
    editable?: boolean
  }) => (
    <View className="mb-4">
      <Text className="text-gray-500 mb-1">{label}</Text>
      {isEditing && editable ? (
        <TextInput
          value={value}
          onChangeText={(text) => handleChange(field, text)}
          className="border border-gray-300 rounded-lg p-3 bg-white"
        />
      ) : (
        <Text className="p-3 bg-gray-100 rounded-lg">
          {value || "Not provided"}
        </Text>
      )}
    </View>
  )

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView className="flex-1 px-4">
        <View className="flex-row justify-between items-center mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Account Details</Text>
          {!isEditing ? (
            <TouchableOpacity
              onPress={() => setIsEditing(true)}
              className="flex-row items-center"
            >
              <Feather name="edit-2" size={18} color="#6B7280" />
              <Text className="ml-1 text-gray-500">Edit</Text>
            </TouchableOpacity>
          ) : (
            <View className="flex-row">
              <TouchableOpacity
                onPress={() => {
                  setIsEditing(false)
                  if (userProfile) {
                    setFormData({
                      firstName: userProfile.firstName || "",
                      lastName: userProfile.lastName || "",
                      email: userProfile.email || "",
                      phone: userProfile.phone || "",
                    })
                  }
                }}
                className="mr-4"
              >
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave}>
                <Text className="text-primary font-medium">Save</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Personal Information */}
        <View className="bg-white rounded-xl shadow-sm p-4 mb-6 mt-10">
          <Text className="text-lg font-medium mb-3">Personal Information</Text>
          <FormField
            label="First Name"
            value={formData.firstName}
            field="firstName"
          />
          <FormField
            label="Last Name"
            value={formData.lastName}
            field="lastName"
          />
          <FormField label="Email" value={formData.email} field="email" />
          <FormField label="Phone" value={formData.phone} field="phone" />
        </View>
      </ScrollView>
    </View>
  )
}
