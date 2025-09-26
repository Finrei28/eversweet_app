import { Dessert, DessertCategory, Offer } from "@/utils/types"
import React, { useState } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
  ScrollView,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { formatCurrency } from "@/lib/formatters"
import CustomModal from "./modal"

type OfferModalProps = {
  offer: Offer
  itemPriceInCents?: number | null
  discountAmount?: number | null
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
                  offer.dessert ? offer.dessert : selectedDessert
                }
                offerId={offer.id}
                offerItemPrice={
                  itemPriceInCents !== null
                    ? itemPriceInCents
                    : offer.dessert
                    ? offer.dessert.priceInCents * (1 - discountAmount)
                    : selectedDessert
                    ? selectedDessert.priceInCents * (1 - discountAmount)
                    : 0
                }
                type="cents"
              />
            )}
          </>
        ) : (
          <View className="flex-1 justify-center items-center bg-black/50 p-4">
            <View className="bg-white rounded-xl p-4 w-full max-h-[80%]">
              <Text className="text-xl font-bold my-5">
                Choose a {offer.category.name} item
              </Text>

              <ScrollView className="overflow-hidden">
                <View className="flex-col gap-y-4">
                  {offer.category.desserts.map((dessert) => (
                    <TouchableOpacity
                      key={dessert.id}
                      onPress={() => handleSelectDessert(dessert)}
                      className="flex-row items-center justify-between bg-secondary rounded-lg p-4"
                    >
                      <View className="flex-row items-center flex-1">
                        <Image
                          source={{ uri: dessert.imagePath }}
                          className="w-20 h-20 rounded-lg mr-4"
                          resizeMode="cover"
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
                          itemPriceInCents !== null
                            ? itemPriceInCents
                            : (dessert.priceInCents * (1 - discountAmount)) /
                                100
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
