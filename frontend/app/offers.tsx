"use client"

import React, { useCallback, useMemo, useState } from "react"
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
import { PrizeCard } from "@/_components/prizeCard"
import { PrizeCodeModal } from "@/_components/prizeCodeModal"
import { useMyPrizesQuery, useOffersQuery } from "@/services/queries"
import { useAuth } from "@/store/authProvider"
import { Offer, Offers, OfferViewer, Prize } from "@/utils/types"
import { getOfferState, groupOffers } from "@/lib/offerHelpers"

/** Until the first fetch lands, assume the least: no perks, nothing unlocked. */
const NO_PERKS: OfferViewer = { isActiveMember: false, isNewCustomer: false }

export default function OffersPage() {
  const router = useRouter()
  const { token, authLoading, dataLoading } = useAuth()

  const [refreshing, setRefreshing] = useState(false)
  const [offerModal, setOfferModal] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [prizeModal, setPrizeModal] = useState(false)
  const [selectedPrize, setSelectedPrize] = useState<Prize | null>(null)

  const {
    data,
    isLoading: loading,
    refetch: getOffers,
    isStale,
  } = useOffersQuery({ enabled: !!token })

  // Separate query rather than folded into the offers payload: a prize is not
  // an offer, and the server keeps them apart for the same reason.
  const { data: prizeData, refetch: refetchPrizes } = useMyPrizesQuery({
    enabled: !!token,
  })
  const prizes = useMemo(() => prizeData ?? [], [prizeData])

  // Memoised so the fallbacks don't hand back a fresh array/object each render
  // and defeat the grouping memo below.
  const offers = useMemo<Offers>(() => data?.offers ?? [], [data])
  const viewer = useMemo<OfferViewer>(() => data?.viewer ?? NO_PERKS, [data])

  // Only when the cached copy has gone stale — this used to refetch the whole
  // payload on every focus, including straight after the mount fetch.
  useFocusEffect(
    useCallback(() => {
      if (!token || !isStale) return

      void getOffers()
    }, [token, isStale, getOffers]),
  )

  // Above the early returns below: hooks cannot run conditionally.
  const { members, newCustomer, everyone } = useMemo(
    () => groupOffers(offers, viewer),
    [offers, viewer],
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    // Both, because a prize can be collected at the counter while this screen
    // is open and the card should stop offering a code that has been spent.
    await Promise.all([getOffers(), refetchPrizes()])
    setRefreshing(false)
  }

  // Stable identities, so the memoised cards are not invalidated on every
  // render by a fresh closure per offer.
  const goToMembership = useCallback(() => router.push("/membership"), [router])

  const handleRedeem = useCallback((offer: Offer) => {
    setSelectedOffer(offer)
    setOfferModal(true)
  }, [])

  const handleShowCode = useCallback((prize: Prize) => {
    setSelectedPrize(prize)
    setPrizeModal(true)
  }, [])

  // OfferModal wants a plain thunk; refetch resolves with the query result.
  const refetchOffers = useCallback(async () => {
    await getOffers()
  }, [getOffers])

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
        unavailableReason={state.unavailableReason}
        onRedeem={handleRedeem}
        onUnlock={goToMembership}
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

        {/* Above the empty state on purpose. `nothingToShow` replaces everything
            inside the branch below, so a prize rendered in there would vanish
            exactly when the customer has no other offers — which is the moment
            it matters most. */}
        {prizes.length > 0 && (
          <View className="mb-2">
            <Text className="text-lg font-semibold mb-3 px-1">
              {prizes.length > 1 ? "Your prizes" : "Your prize"}
            </Text>
            {prizes.map((prize) => (
              <PrizeCard
                key={prize.id}
                prize={prize}
                onShowCode={handleShowCode}
              />
            ))}
          </View>
        )}

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
          refetchOffers={refetchOffers}
        />
      )}

      {prizeModal && selectedPrize && (
        <PrizeCodeModal
          prize={selectedPrize}
          visible={prizeModal}
          onClose={() => setPrizeModal(false)}
        />
      )}
    </View>
  )
}
