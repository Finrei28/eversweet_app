"use client"

import React, { useState } from "react"
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
  TouchableWithoutFeedback,
  Alert,
  ActivityIndicator,
} from "react-native"
import { Feather } from "@expo/vector-icons"
import { cancelMembership } from "@/services/stripe-api"
import Toast from "react-native-toast-message"
import { formatShortDate } from "@/lib/formatters"
import { MembershipDetails } from "@/utils/types"

type CancelMembershipModalProps = {
  modalVisible: boolean
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  membershipDetails: MembershipDetails | null
}
export default function CancelMembershipModal({
  modalVisible,
  setModalVisible,
  membershipDetails,
}: CancelMembershipModalProps) {
  const [canceling, setCanceling] = useState(false)
  const handleClose = async () => {
    setModalVisible(false)
  }

  const handleCancelMembership = async () => {
    try {
      setCanceling(true)
      const expiresAt = await cancelMembership()
      setModalVisible(false)
      Toast.show({
        type: "success",
        text1: `Membership canceled`,
        text2: `Your membership will expire on ${formatShortDate(expiresAt)}.`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 90,
        props: {
          text1NumberOfLines: 0,
          text2NumberOfLines: 0, // allow wrapping
        },
      })
    } catch (error) {
      Alert.alert(`Failed to cancel membership: ${(error as Error).message}`)
    } finally {
      setCanceling(false)
    }
  }

  return (
    <>
      {/* Membership Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={handleClose}>
          <View className="flex-1 bg-black/50 justify-center items-center px-4">
            <TouchableWithoutFeedback>
              <View className="bg-white rounded-2xl p-6 w-full max-w-md relative items-center">
                {/* Close button */}
                <View className="flex-row justify-between">
                  <Image
                    source={{
                      uri: "https://res.cloudinary.com/dlqjgl6ju/image/upload/v1747456979/eversweet_square_u6iyov.png",
                    }}
                    className="w-full h-40 rounded-xl mb-4"
                    resizeMode="contain"
                  />
                  <TouchableOpacity className="" onPress={handleClose}>
                    <Text className="text-gray-700 text-xl font-bold">✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Banner image */}

                {/* Title */}
                <Text className="text-2xl font-bold text-center mb-2">
                  Membership Cancellation
                </Text>

                {/* Description */}
                <Text className="text-gray-700 text-center mb-1">
                  Are you sure you want to cancel your membership?
                </Text>
                <Text className="text-gray-700 text-center mb-1">
                  You will lose access to exclusive discounts, exclusive offers,
                  and bonus loyalty rewards.
                </Text>
                <Text className="text-gray-700 text-center mb-1 font-bold">
                  If your membership ever expires, your membership discount will
                  reset and will start from the lowest discount.
                </Text>
                <Text className="text-gray-700 text-center mb-1 font-semibold">
                  Don't miss out on these awesome offers!
                </Text>
                <View className="space-y-3 my-6 px-5">
                  {membershipDetails?.membershipBenefits.map(
                    (benefits, index) => (
                      <View className="flex-row" key={index}>
                        <Feather name="x-circle" size={18} color="#EF4444" />
                        <Text className="ml-2 text-gray-700">{benefits}</Text>
                      </View>
                    ),
                  )}
                </View>

                {/* Join button */}
                <TouchableOpacity
                  className="bg-red-500 px-6 py-3 rounded-lg w-[80%]"
                  onPress={handleCancelMembership}
                  disabled={canceling}
                >
                  {canceling ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-white text-center font-bold text-lg">
                      Cancel Membership
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  )
}
