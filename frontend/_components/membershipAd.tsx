import React, { useState } from "react"
import { View, Text, Modal, TouchableOpacity, Image } from "react-native"
import { setMembershipPopupExpiration } from "@/services/notifications"
import { useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"

type MembershipPopupProps = {
  modalVisible: boolean
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
}
export default function MembershipPopup({
  modalVisible,
  setModalVisible,
}: MembershipPopupProps) {
  const router = useRouter()
  const handleClose = async () => {
    setModalVisible(false)
    await setMembershipPopupExpiration()
  }

  const handleJoinNow = async () => {
    setModalVisible(false)
    await setMembershipPopupExpiration()
    router.push("/membership")
  }

  return (
    <View className="flex-1 justify-center items-center bg-gray-100">
      {/* Membership Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-4">
          <View className="bg-white rounded-2xl p-6 w-full max-w-md relative items-center">
            {/* Close button */}
            <TouchableOpacity
              className="absolute top-4 right-4"
              onPress={() => handleClose()}
            >
              <Text className="text-gray-600 text-2xl font-bold">×</Text>
            </TouchableOpacity>

            {/* Banner image */}
            <Image
              source={{
                uri: "https://res.cloudinary.com/dlqjgl6ju/image/upload/v1747456979/eversweet_square_u6iyov.png",
              }}
              className="w-full h-40 rounded-xl mb-4"
              resizeMode="contain"
            />

            {/* Title */}
            <Text className="text-2xl font-bold text-center mb-2">
              Join our Membership Today!
            </Text>

            {/* Description */}
            <Text className="text-gray-700 text-center">
              Enjoy exclusive discounts, exclusive offers, and 2x loyalty
              rewards.
            </Text>
            <View className="space-y-3 my-6">
              <View className="flex-row items-center">
                <Feather name="check-circle" size={18} color="#10B981" />
                <Text className="ml-2 text-gray-700">
                  free weekly Mochi Series bowl ($9.99)
                </Text>
              </View>
              <View className="flex-row items-center">
                <Feather name="check-circle" size={18} color="#10B981" />
                <Text className="ml-2 text-gray-700">
                  15% discount on all listed items
                </Text>
              </View>
              <View className="flex-row items-center">
                <Feather name="check-circle" size={18} color="#10B981" />
                <Text className="ml-2 text-gray-700">
                  Earn 2x loyalty points
                </Text>
              </View>
              <View className="flex-row items-center">
                <Feather name="check-circle" size={18} color="#10B981" />
                <Text className="ml-2 text-gray-700">
                  Exclusive member offers
                </Text>
              </View>
              <View className="flex-row items-center">
                <Feather name="check-circle" size={18} color="#10B981" />
                <Text className="ml-2 text-gray-700">Cancel anytime</Text>
              </View>
              <View className="flex-row items-center">
                <Text className=" text-gray-700">
                  More benefits to come in the future...
                </Text>
              </View>
            </View>

            {/* Join button */}
            <TouchableOpacity
              className="bg-primary px-6 py-3 rounded-lg w-full"
              onPress={() => handleJoinNow()}
            >
              <Text className="text-white text-center font-bold text-lg">
                Join Now
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}
