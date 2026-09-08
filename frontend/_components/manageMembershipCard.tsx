import React, { useState } from "react"
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from "react-native"
import Toast from "react-native-toast-message"
import { useAuth } from "@/store/authProvider"
import { resumeMembership } from "@/services/stripe-api"
import { formatShortDate } from "@/lib/formatters"
import { getErrorMessage } from "@/utils/getError"
import CancelMembershipModal from "@/_components/cancelMembershipModal"
import { UsersMembership } from "@/utils/types"

/**
 * Cancellation / re-subscribe / payment-retry controls for an active member.
 *
 * Owns its own cancel-confirmation modal, the same way MemberOffersPreview
 * owns its own fetch — this is the only place either is used.
 */
export default function ManageMembershipCard({
  usersMembership,
  isProcessingPayment,
  onRetryPayment,
}: {
  usersMembership: UsersMembership
  isProcessingPayment: boolean
  onRetryPayment: () => void
}) {
  const { membershipDetails, refetchUsersMembership } = useAuth()
  const [isResuming, setIsResuming] = useState(false)
  const [cancelMembership, setCancelMembership] = useState(false)

  const handleResumeMembership = async () => {
    setIsResuming(true)
    try {
      await resumeMembership()
      await refetchUsersMembership()
      Toast.show({
        type: "success",
        text1: `Your membership has been resumed.`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
        props: {
          text1NumberOfLines: 0,
          text2NumberOfLines: 0, // allow wrapping
        },
      })
    } catch (error) {
      Alert.alert(
        "Failed to resume your membership",
        getErrorMessage(
          error,
          "Could not resume your membership at this time. Please try again later or contact support.",
        ),
      )
    } finally {
      setIsResuming(false)
    }
  }

  return (
    <>
      <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <Text className="text-lg font-medium mb-3">Manage Membership</Text>
        {usersMembership.cancel ? (
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-500">
              Expires on: {formatShortDate(usersMembership.endDate)}
            </Text>
            <TouchableOpacity
              onPress={handleResumeMembership}
              disabled={isResuming}
              className="bg-primary px-3 py-2 rounded-lg items-center justify-center"
            >
              <Text className={`text-white ${isResuming ? "opacity-0" : ""}`}>
                Re-subscribe
              </Text>

              {isResuming && (
                <ActivityIndicator color="white" className="absolute" />
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-row items-center justify-between">
            <Text
              className={
                usersMembership.paymentStatus === "SUCCESS"
                  ? "text-gray-500"
                  : "text-red-500"
              }
            >
              {usersMembership.paymentStatus === "SUCCESS"
                ? `${"Renews on: " + formatShortDate(usersMembership.endDate)}`
                : "Payment Failed"}
            </Text>
            <TouchableOpacity
              onPress={() =>
                usersMembership.paymentStatus === "SUCCESS"
                  ? setCancelMembership(true)
                  : onRetryPayment()
              }
              className={`${usersMembership.paymentStatus === "SUCCESS" ? "bg-red-500" : "bg-primary"} px-3 py-2 rounded-lg items-center justify-center`}
              disabled={isProcessingPayment}
            >
              {isProcessingPayment ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-white">
                  {usersMembership.paymentStatus === "SUCCESS"
                    ? "Cancel"
                    : "Retry payment"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {cancelMembership && (
        <CancelMembershipModal
          modalVisible={cancelMembership}
          setModalVisible={setCancelMembership}
          membershipDetails={membershipDetails}
          onCancelled={refetchUsersMembership}
        />
      )}
    </>
  )
}
