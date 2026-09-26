import React, { useState } from "react"
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from "react-native"
import Toast from "react-native-toast-message"
import { useAuth } from "@/store/authProvider"
import { resumeMembership } from "@/services/stripe-api"
import { formatShortDate } from "@/lib/formatters"
import { getErrorMessage } from "@/utils/getError"
import CancelMembershipModal from "@/_components/cancelMembershipModal"
import { useMembershipDetailsQuery } from "@/services/queries"
import { UsersMembership } from "@/utils/types"
import {
  builtUpDiscountPercent,
  headlinePerk,
  needsBankConfirmation,
} from "@/lib/membership"

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
  const { token, refetchUsersMembership } = useAuth()
  const { data: membershipDetails } = useMembershipDetailsQuery({
    enabled: !!token,
  })
  const [isResuming, setIsResuming] = useState(false)
  const [cancelMembership, setCancelMembership] = useState(false)

  // What the member stands to lose, named the way the pushes and the banner name it: their
  // own figure, a perk from the plan's list, and the rest.
  const discount = builtUpDiscountPercent(usersMembership)
  const perk = headlinePerk(membershipDetails?.membershipBenefits ?? [])
  const atStake = perk
    ? `your ${discount}% discount, ${perk} and your other member benefits`
    : `your ${discount}% discount and your other member benefits`
  // The bank is waiting for the member to confirm the payment: nothing is wrong with the card,
  // and Retry is what shows the bank's check, so neither is worded as a failure.
  const confirmWithBank = needsBankConfirmation(usersMembership)

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
      // A membership that has ended can't be resumed, and the server records the end before
      // saying so. Reloading swaps this card for the join; without it the button stayed, and
      // every tap failed the same way until the customer left the screen.
      await refetchUsersMembership()
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
                : confirmWithBank
                  ? "Your bank needs you to confirm"
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
                    : confirmWithBank
                      ? "Confirm payment"
                      : "Retry payment"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        {/* Cancelled: nothing is lost until the end date, and re-subscribing before it keeps
            the run - so say what goes, while there is still time to keep it. */}
        {usersMembership.cancel && usersMembership.paymentStatus === "SUCCESS" && (
          <Text className="text-gray-500 mt-3">
            Re-subscribe before then to keep {atStake}.
          </Text>
        )}
        {/* On hold: a renewal was declined and is being retried. The server pauses every
            member benefit until it is paid, so say so rather than leave the customer to
            find out at checkout. */}
        {usersMembership.paymentStatus === "PENDING" && (
          <Text className="text-gray-500 mt-3">
            {atStake.charAt(0).toUpperCase() + atStake.slice(1)} are paused until this
            payment goes through.
          </Text>
        )}
      </View>

      {cancelMembership && (
        <CancelMembershipModal
          modalVisible={cancelMembership}
          setModalVisible={setCancelMembership}
          membershipDetails={membershipDetails ?? null}
          usersMembership={usersMembership}
          onCancelled={refetchUsersMembership}
        />
      )}
    </>
  )
}
