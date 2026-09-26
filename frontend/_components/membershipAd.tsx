import React from "react"
import { View, Text, Modal, TouchableOpacity } from "react-native"
import { setMembershipPopupExpiration } from "@/services/notifications"
import { useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import { useAuth } from "@/store/authProvider"
import { useMembershipDetailsQuery } from "@/services/queries"
import EversweetLogo from "./eversweetLogo"

type MembershipPopupProps = {
  modalVisible: boolean
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
}
export default function MembershipPopup({
  modalVisible,
  setModalVisible,
}: MembershipPopupProps) {
  const { token } = useAuth()
  const { data: membershipDetails } = useMembershipDetailsQuery({
    enabled: !!token,
  })
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
    <View>
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

            {/* Bundled, not a Cloudinary URL typed in here: an asset renamed or deleted
                there left the popup with a blank space where its picture was. */}
            <View className="mt-6 mb-6">
              <EversweetLogo height={64} />
            </View>

            {/* Title */}
            <Text className="text-2xl font-bold text-center mb-2">
              Join our Membership Today!
            </Text>

            {/* Description */}
            <Text className="text-gray-700 text-center">
              Enjoy exclusive discounts, exclusive offers, and bonus loyalty
              rewards.
            </Text>
            <View className="space-y-3 my-6 px-5">
              {membershipDetails?.membershipBenefits.map((benefits, index) => (
                <View className="flex-row" key={index}>
                  {/* A tick, as the membership screen lists them: this is what joining
                      gives. The red cross read as "you don't get this". */}
                  <Feather name="check-circle" size={18} color="#10B981" />
                  <Text className="ml-2 text-gray-700">{benefits}</Text>
                </View>
              ))}
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
