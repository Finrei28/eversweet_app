import React, { useState, useEffect } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native"
import { useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import { updateAnonymousStatus, updateUserProfile } from "@/services/api"
import { useAuth } from "@/store/authProvider"
import { queryClient } from "@/services/queryClient"
import { queryKeys } from "@/services/queries"
import parsePhoneNumberFromString from "libphonenumber-js"
import { PROFILE_FIELD_MAX_LENGTH } from "@/lib/profileFields"

const FormField = ({
  label,
  value,
  field,
  editable = true,
  isEditing,
  handleChange,
}: {
  label: string
  value: string
  field: string
  editable?: boolean
  isEditing: boolean
  handleChange: (field: string, value: string) => void
}) => {
  return (
    <View className="mb-4">
      <Text className="text-gray-500 mb-1">{label}</Text>

      {isEditing && editable ? (
        <TextInput
          value={value}
          maxLength={
            PROFILE_FIELD_MAX_LENGTH[
              field as keyof typeof PROFILE_FIELD_MAX_LENGTH
            ]
          }
          keyboardType={field === "phone" ? "phone-pad" : "default"}
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
}

export default function AccountDetails() {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const {
    token,
    authLoading,
    dataLoading,
    setUserDetails,
    userDetails,
    refetchUserDetails,
    refetchLeaderboardDetails,
  } = useAuth()

  const [isChanging, setIsChanging] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  })

  useEffect(() => {
    if (authLoading) return
    if (!token) {
      router.push("/signin")
    }
  }, [token, authLoading, router])

  useEffect(() => {
    if (userDetails) {
      setFormData({
        firstName: userDetails.firstName || "",
        lastName: userDetails.lastName || "",
        email: userDetails.email || "",
        phone: userDetails.phone || "",
      })
    }
    // userDetails arrives asynchronously from AuthProvider, so this has to
    // re-run once it lands or the form renders blank.
  }, [userDetails])

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleSave = async () => {
    const phone = parsePhoneNumberFromString(formData.phone, "NZ")
    if (!formData.firstName) {
      Alert.alert("Error", "Please enter your first name")
      return
    }
    if (!formData.lastName) {
      Alert.alert("Error", "Please enter your last name")
      return
    }
    if (!phone?.isValid()) {
      Alert.alert("Error", "Please enter a valid phone number")
      return
    }
    try {
      const newData = { ...formData, phone: phone.format("E.164") }

      // Call API to update profile
      await updateUserProfile(newData)
      setIsEditing(false)
      refetchUserDetails()
    } catch (error) {
      console.error("Failed to update profile:", error)
    }
  }

  const handleAnonymousChange = async (value: boolean) => {
    // Captured so a failed write can put the switch back where the server actually stands.
    // Left where it was flipped, a customer who thinks they are anonymous is not - on a
    // list whose top three is public.
    let restore: boolean | undefined
    try {
      setIsChanging(true)
      setUserDetails((prev) => {
        if (!prev) return prev
        restore = prev.anonymousEnabled
        return { ...prev, anonymousEnabled: value }
      })
      await updateAnonymousStatus(value)
      // The board is cached for 30 seconds; without this their own row keeps the old name.
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      // And last month's podium banner, which is loaded separately, at launch.
      void refetchLeaderboardDetails()
    } catch (error) {
      console.error("Failed to update anonymous status: ", error)
      setUserDetails((prev) =>
        prev && restore !== undefined
          ? { ...prev, anonymousEnabled: restore }
          : prev,
      )
    } finally {
      setIsChanging(false)
    }
  }

  if (authLoading || dataLoading) {
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1"
    >
      <View className="flex-1 bg-background">
        <CustomHeader />
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
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
                    if (userDetails) {
                      setFormData({
                        firstName: userDetails.firstName || "",
                        lastName: userDetails.lastName || "",
                        email: userDetails.email || "",
                        phone: userDetails.phone || "",
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
            <Text className="text-lg font-medium mb-3">
              Personal Information
            </Text>
            <FormField
              label="First Name"
              value={formData.firstName}
              field="firstName"
              isEditing={isEditing}
              handleChange={handleChange}
            />
            <FormField
              label="Last Name"
              value={formData.lastName}
              field="lastName"
              isEditing={isEditing}
              handleChange={handleChange}
            />
            <FormField
              label="Email"
              value={formData.email}
              field="email"
              isEditing={isEditing}
              handleChange={handleChange}
              editable={false}
            />
            <FormField
              label="Phone"
              value={formData.phone}
              field="phone"
              isEditing={isEditing}
              handleChange={handleChange}
            />
          </View>
          <View className="flex-row justify-between items-center py-4 px-5 bg-white rounded-xl mb-3">
            <View className="flex-1">
              <Text className="text-base font-medium mb-1">
                Anonymous Status
              </Text>
              <Text className="text-sm text-gray-500 w-4/5">
                Toggle to be anonymous on the leaderboard
              </Text>
            </View>
            <View>
              <Switch
                value={userDetails?.anonymousEnabled}
                onValueChange={handleAnonymousChange}
                disabled={isChanging}
                trackColor={{ false: "#D1D5DB", true: "#10B981" }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
