"use client"

import React, { useCallback, useState } from "react"
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import OfferCard from "@/_components/offerCard"
import AudienceBadge from "@/_components/audienceBadge"
import OfferModal from "@/_components/offerModal"
import { showOffers } from "@/services/api"
import { useAuth } from "@/store/authProvider"
import { Offer, Offers, OfferViewer } from "@/utils/types"
import { getOfferState, groupOffers } from "@/lib/offerHelpers"

/** Until the first fetch lands, assume the least: no perks, nothing unlocked. */
const NO_PERKS: OfferViewer = { isActiveMember: false, isNewCustomer: false }

export default function OffersPage() {
  const router = useRouter()
  const { token, authLoading, dataLoading } = useAuth()

  const [offers, setOffers] = useState<Offers>([])
  const [viewer, setViewer] = useState<OfferViewer>(NO_PERKS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offerModal, setOfferModal] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)

  const getOffers = async () => {
    try {
      const result = await showOffers()
      setOffers(result.offers ?? [])
      setViewer(result.viewer ?? NO_PERKS)
    } catch (error) {
      // Without this the spinner never clears and the rejection goes unhandled.
      console.error("Failed to load offers", error)
      setOffers([])
    } finally {
      setLoading(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setLoading(false)
        return
      }
      getOffers()
    }, [token]),
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await getOffers()
    setRefreshing(false)
  }

  const handleRedeem = (offer: Offer) => {
    setSelectedOffer(offer)
    setOfferModal(true)
  }

  if (authLoading || dataLoading || loading) {
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
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <Text className="text-xl font-bold text-center px-4">
            Sign in to see the offers waiting for you!
          </Text>
          <TouchableOpacity
            className="bg-primary p-3 rounded-lg w-1/3 items-center mt-5"
            onPress={() =>
              router.push({
                pathname: "/signin",
                params: { redirectTo: "/offers" },
              })
            }
          >
            <Text className="text-white text-xl">Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const { members, newCustomer, everyone } = groupOffers(offers, viewer)
  const nothingToShow =
    members.length === 0 && newCustomer.length === 0 && everyone.length === 0

  const renderOffer = (offer: Offer) => {
    const state = getOfferState(offer, viewer)
    return (
      <OfferCard
        key={offer.id}
        offer={offer}
        locked={state.locked}
        isRedeemable={state.isRedeemable}
        alreadyRedeemed={state.alreadyRedeemed}
        onRedeem={handleRedeem}
        onUnlock={() => router.push("/membership")}
      />
    )
  }

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView
        className="flex-1 px-4 mb-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View className="flex-row justify-between items-center mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Offers</Text>
        </View>

        {nothingToShow ? (
          <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
            <Feather name="tag" size={48} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500 text-center">
              No offers available right now. Check back soon!
            </Text>
            <TouchableOpacity
              className="mt-4 bg-primary py-2 px-4 rounded-lg"
              onPress={() => router.push("/menu")}
            >
              <Text className="text-white font-medium">Browse the menu</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {members.length > 0 && (
              <View className="mb-6">
                <View className="flex-row items-center mb-3 px-1">
                  <Text className="text-lg font-semibold mr-2">
                    Member Offers
                  </Text>
                  <AudienceBadge audience="MEMBERS" />
                </View>

                {!viewer.isActiveMember && (
                  <View className="bg-white rounded-xl shadow-sm p-4 mb-2">
                    <Text className="font-medium text-gray-800">
                      Unlock these with a membership
                    </Text>
                    <Text className="text-gray-500 text-sm mt-1">
                      Members get exclusive offers, a growing discount on every
                      order, and double loyalty points.
                    </Text>
                    <TouchableOpacity
                      className="bg-primary py-2 px-4 rounded-lg items-center mt-3"
                      onPress={() => router.push("/membership")}
                    >
                      <Text className="text-white font-medium">
                        See membership
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View className="gap-2">{members.map(renderOffer)}</View>
              </View>
            )}

            {newCustomer.length > 0 && (
              <View className="mb-6">
                <View className="flex-row items-center mb-3 px-1">
                  <Text className="text-lg font-semibold mr-2">
                    Just for You
                  </Text>
                  <AudienceBadge audience="NEW_USERS" />
                </View>
                <Text className="text-gray-500 text-sm mb-3 px-1">
                  A welcome from us — available until your first order.
                </Text>
                <View className="gap-2">{newCustomer.map(renderOffer)}</View>
              </View>
            )}

            {everyone.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-semibold mb-3 px-1">
                  Open to Everyone
                </Text>
                <View className="gap-2">{everyone.map(renderOffer)}</View>
              </View>
            )}
          </>
        )}

        <View className="mb-10" />
      </ScrollView>

      {offerModal && selectedOffer && (
        <OfferModal
          offer={selectedOffer}
          itemPriceInCents={selectedOffer.itemPriceInCents}
          discountAmount={selectedOffer.discountAmount}
          offerModal={offerModal}
          setOfferModal={setOfferModal}
          refetchOffers={getOffers}
        />
      )}
    </View>
  )
}
