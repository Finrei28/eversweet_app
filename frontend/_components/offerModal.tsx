import { Dessert, Offer } from "@/utils/types"
import React, { useState } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
} from "react-native"
import { formatCurrency } from "@/lib/formatters"
import { offerUnitPriceInCents } from "@/lib/offerHelpers"
import CustomModal from "./modal"
import { CachedImage } from "@/_components/cachedImage"

type OfferModalProps = {
  offer: Offer
  itemPriceInCents: number | null
  discountAmount: number | null
  offerModal: boolean
  setOfferModal: React.Dispatch<React.SetStateAction<boolean>>
  refetchOffers: () => Promise<void>
}

export default function OfferModal({
  offer,
  itemPriceInCents,
  discountAmount,
  offerModal,
  setOfferModal,
  refetchOffers,
}: OfferModalProps) {
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [modalVisible, setModalVisible] = useState(false)

  const handleSelectDessert = (dessert: Dessert) => {
    setSelectedDessert(dessert)
    setModalVisible(true)
  }

  return (
    <View>
      {/* Modal */}
      <Modal
        visible={offerModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setOfferModal(false)}
      >
        {offer.dessert || selectedDessert ? (
          <>
            {modalVisible && (
              <CustomModal
                refetchOffers={refetchOffers}
                modalVisible={modalVisible}
                setModalVisible={setModalVisible}
                setOfferModal={setOfferModal}
                setSelectedDessert={setSelectedDessert}
                selectedDessert={
                  offer.dessert ? offer.dessert : selectedDessert!
                }
                offerId={offer.id}
                offerItemPrice={offerUnitPriceInCents(
                  { itemPriceInCents, discountAmount },
                  offer.dessert ?? selectedDessert,
                )}
                type="cents"
              />
            )}
          </>
        ) : (
          <View className="flex-1 justify-center items-center bg-black/50 p-4">
            <View className="bg-white rounded-xl p-4 w-full max-h-[80%]">
              <Text className="text-xl font-bold my-5">
                Choose a {offer.category?.name} item
              </Text>

              <ScrollView className="overflow-hidden">
                <View className="flex-col gap-y-4">
                  {offer.category?.desserts.map((dessert) => (
                    <TouchableOpacity
                      key={dessert.id}
                      onPress={() => handleSelectDessert(dessert)}
                      className="flex-row items-center justify-between bg-secondary rounded-lg p-4"
                    >
                      <View className="flex-row items-center flex-1">
                        <CachedImage
                          uri={dessert.imagePath}
                          className="w-20 h-20 rounded-lg mr-4"
                          resizeMode="cover"
                          recyclingKey={dessert.id}
                        />
                        {/* Wrap the name text */}
                        <Text
                          className="text-gray-800 font-medium text-lg flex-shrink"
                          style={{ flexShrink: 1, flexWrap: "wrap" }}
                        >
                          {dessert.name}
                        </Text>
                      </View>

                      <Text className="text-lg font-medium ml-2">
                        {formatCurrency(
                          offerUnitPriceInCents(
                            { itemPriceInCents, discountAmount },
                            dessert,
                          ) / 100,
                        )}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={() => setOfferModal(false)}
                className="bg-red-500 mt-4 px-4 py-4 rounded-lg items-center"
              >
                <Text className="text-white font-bold">Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  )
}
