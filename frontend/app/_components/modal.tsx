import {
  View,
  Image,
  Text,
  TouchableOpacity,
  ScrollView,
  PanResponder,
  Pressable,
  Animated,
  Dimensions,
} from "react-native"
import Modal from "react-native-modal"
import { Dessert } from "../../utils/types"
import { useCartStore } from "@/store/cart"
import { useEffect, useState, useRef } from "react"
import { SafeAreaView } from "react-native-safe-area-context"
import AntDesign from "@expo/vector-icons/AntDesign"
import BouncingLoader from "@/_components/loader"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import useFetch from "@/services/use_fetch"
import { getAvailableCustomisations } from "@/services/api"
import { Customisations } from "../../utils/types"
import uuid from "react-native-uuid"

type CustomModalProps = {
  modalVisible: boolean
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  selectedDessert: Dessert
  type: "cents" | "points"
  state?: "add" | "edit"
  showToast?: () => void
  customisations?: Customisations
  editItemPrice?: number
  editId?: string
}

export default function CustomModal({
  modalVisible,
  setModalVisible,
  selectedDessert,
  type,
  showToast,
  state = "add",
  customisations,
  editItemPrice,
  editId,
}: CustomModalProps) {
  const addItem = useCartStore((state) => state.addItem)
  const editItem = useCartStore((state) => state.editItem)
  const {
    data: availableCustomisations,
    error,
    loading: availableCustomisationsLoading,
  } = useFetch(() => getAvailableCustomisations())
  const [quantity, setQuantity] = useState(1)
  const [price, setPrice] = useState(
    editItemPrice ? editItemPrice : selectedDessert.priceInCents
  )
  const [buttonLoading, setButtonLoading] = useState(false)
  const [customisationQuantity, setCustomisationQuantity] =
    useState<Customisations>([])
  const points = Math.round(selectedDessert.priceInCents / 5) * 5

  useEffect(() => {
    if (state === "edit" && customisations) {
      const initialQuantities = customisations.map((c) => ({
        id: c.id,
        name: c.name,
        chineseName: c.chineseName,
        quantity: c.quantity,
      }))

      setCustomisationQuantity(initialQuantities)
    }
  }, [state, customisations])

  // ---------- PANRESPONDER (for outside-ScrollView swipe/tap) ----------
  // We'll attach this to the header area (above the ScrollView) and
  // the footer/button area (below the ScrollView). That means swipes
  // or taps that start on those non-scrolling areas will close the modal.
  const translateY = useRef(new Animated.Value(0)).current
  const screenHeight = Dimensions.get("window").height

  const closeWithAnimation = () => {
    Animated.timing(translateY, {
      toValue: screenHeight, // slide down off screen
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setModalVisible(false)
      // Reset AFTER modal fully closes/unmounts
      setTimeout(() => {
        translateY.setValue(0)
      }, 0)
    })
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          translateY.setValue(gesture.dy)
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 200 || gesture.vy > 1) {
          closeWithAnimation()
        } else {
          // snap back
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start()
        }
      },
    })
  ).current

  // --------------------------------------------------------------------

  const handleIncrease = (ingredientName: string) => {
    const customisation = availableCustomisations.find(
      (c) => c.name === ingredientName
    )

    if (!customisation) return

    setCustomisationQuantity((prev) => {
      const existingItem = prev.find((item) => item.name === ingredientName)

      if (existingItem) {
        // If the customization already exists, increase the quantity
        const newQuantity = existingItem.quantity + 1
        if (newQuantity === 1) {
          return prev.filter((item) => item.name !== ingredientName)
        }

        return prev.map((item) => {
          if (item.name === ingredientName) {
            const included =
              selectedDessert.ingredients.includes(ingredientName)
            if (!included) {
              setPrice((prev) => prev + customisation.priceInCents)
            }

            // Increase price only if crossing 1 → 2 //
            else if (item.quantity >= 1) {
              setPrice((prev) => prev + customisation.priceInCents)
            }

            return { ...item, quantity: newQuantity }
          }
          return item
        })
      } else {
        // If the customization doesn't exist, add a new item to the state
        const newCustomization = {
          id: customisation.id,
          name: customisation.name,
          chineseName: customisation.chineseName,
          quantity: 1, // Set initial quantity to 1
        }

        // Increase price if this is the first customization
        setPrice((prev) => prev + customisation.priceInCents)

        return [...prev, newCustomization] // Add new customization to the state
      }
    })
  }

  const handleDecrease = (ingredientName: string) => {
    const customisation = availableCustomisations.find(
      (c) => c.name === ingredientName
    )
    if (!customisation) return

    setCustomisationQuantity((prev) => {
      const existingItem = prev.find((item) => item.name === ingredientName)

      const included = selectedDessert.ingredients.includes(ingredientName)

      if (existingItem) {
        // If the customization exists and quantity is more than 0, decrease the quantity
        if (existingItem.quantity > 0) {
          const newQuantity = existingItem.quantity - 1
          if (existingItem.quantity === 1) {
            setPrice((prev) => Math.max(0, prev - customisation.priceInCents))
            return prev.filter((item) => item.name !== ingredientName)
          }
          if (!included) {
            setPrice((prev) => Math.max(0, prev - customisation.priceInCents))
            if (newQuantity === 0)
              return prev.filter((item) => item.name !== ingredientName)
          }

          // Decrease price only if crossing 2 → 1
          else if (existingItem.quantity > 1) {
            setPrice((prev) => Math.max(0, prev - customisation.priceInCents))
          }

          // Return the updated array with the decreased quantity
          return prev.map((item) =>
            item.name === ingredientName
              ? { ...item, quantity: newQuantity }
              : item
          )
        }
      } else {
        const newCustomization = {
          id: customisation.id,
          name: customisation.name,
          chineseName: customisation.chineseName,
          quantity: 0, // Set initial quantity to 0
        }

        return [...prev, newCustomization]
      }
      return prev // Return the unchanged state if the customization doesn't exist or quantity is 0
    })
  }

  const insets = useSafeAreaInsets()
  return (
    <Modal
      isVisible={modalVisible}
      backdropOpacity={0.5}
      animationIn="slideInUp"
      animationOut="fadeOut"
      style={{ justifyContent: "flex-end", margin: 0 }}
      onBackdropPress={closeWithAnimation}
      propagateSwipe={true}
    >
      <Animated.View
        style={{
          transform: [{ translateY }],
          paddingTop: insets.top ? insets.top : 20,
          paddingBottom: insets.bottom ? insets.bottom : 30,
          borderRadius: 20,
        }}
        className="flex-1 bg-background bg-opacity-60 justify-center "
      >
        {(!selectedDessert || availableCustomisationsLoading) &&
        modalVisible ? (
          <View className="flex-1 items-center justify-center">
            <BouncingLoader />
          </View>
        ) : (
          <SafeAreaView className="flex-1 justify-between bg-background rounded-lg px-2">
            {selectedDessert && (
              <>
                {/* ---------- HEADER AREA (attach pan handlers here) ---------- */}
                <View {...panResponder.panHandlers} className="w-full">
                  {/* Tapping/swiping this header area will close the modal. */}
                  <View>
                    <View className="flex-row items-center justify-center mb-5">
                      <View className="items-center">
                        <Text className="text-3xl font-bold text-center">
                          {selectedDessert.name}
                        </Text>
                        <Text className="text-gray-600 italic text-2xl font-semibold text-center">
                          {selectedDessert.chineseName}
                        </Text>
                      </View>
                    </View>

                    <Image
                      source={{ uri: selectedDessert.imagePath }}
                      style={{ width: "100%", height: 200, borderRadius: 10 }}
                      resizeMode="cover"
                      className="px-3"
                    />
                    <View className="px-3">
                      <Text className="mt-5 ">
                        Ingredients: {selectedDessert.ingredients.join(", ")}
                      </Text>
                      <Text className="mt-2 font-semibold text-lg">
                        Price:{" "}
                        {type === "cents"
                          ? `$ ${Number(price) / 100}`
                          : `${points} points`}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* ---------- SCROLLABLE CUSTOMISATIONS ---------- */}
                <ScrollView
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedDessert.ingredients
                    .filter((ingredient) =>
                      availableCustomisations.some((c) => c.name === ingredient)
                    )
                    .map((c) => {
                      const toppingQuantity = customisationQuantity.find(
                        (item) => item.name === c
                      )?.quantity

                      const quantity =
                        toppingQuantity >= 1
                          ? toppingQuantity + 1
                          : toppingQuantity === 0
                          ? toppingQuantity
                          : 1

                      return (
                        <View
                          key={c}
                          className="flex-row justify-between items-center rounded-lg bg-slate-50 p-3"
                        >
                          <View className="flex-row flex-1 items-center gap-4">
                            <View>
                              <Text className="text-lg">{c}</Text>
                            </View>

                            <View className="ml-2 mr-2 bg-green-100  px-2 py-0.5 rounded-full">
                              <Text className="text-green-600 text-sm">
                                Included
                              </Text>
                            </View>
                          </View>

                          <View className="flex-row items-center gap-3">
                            <TouchableOpacity
                              className="items-center justify-center"
                              onPress={() => handleDecrease(c)}
                              disabled={quantity === 0}
                            >
                              <AntDesign
                                name="minuscircleo"
                                size={30}
                                color={
                                  type === "points" && quantity === 0
                                    ? "gray"
                                    : "#e6aa6b"
                                }
                              />
                            </TouchableOpacity>

                            <Text className="w-6 text-center text-lg">
                              {quantity ?? 0}
                            </Text>

                            <TouchableOpacity
                              className={`items-center justify-center`}
                              disabled={type === "points" && quantity === 1}
                              onPress={() => handleIncrease(c)}
                            >
                              <AntDesign
                                name="pluscircleo"
                                size={30}
                                color={
                                  type === "points" && quantity === 1
                                    ? "gray"
                                    : "#e6aa6b"
                                }
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      )
                    })}

                  {type === "cents" &&
                    availableCustomisations
                      ?.filter(
                        (item) =>
                          !selectedDessert.ingredients.includes(item.name)
                      )
                      .map((c) => {
                        const toppingQuantity = customisationQuantity.find(
                          (item) => item.name === c.name
                        )?.quantity

                        const quantity =
                          toppingQuantity >= 1 ? toppingQuantity : 0

                        return (
                          <View
                            key={c.name}
                            className="flex-row justify-between items-center rounded-lg bg-slate-50 p-3"
                          >
                            <View className="flex-row flex-1 items-center gap-4">
                              <View>
                                <Text className="text-lg">{c.name}</Text>
                              </View>
                            </View>

                            <View className="flex-row items-center gap-3">
                              <TouchableOpacity
                                className="items-center justify-center"
                                onPress={() => handleDecrease(c.name)}
                                disabled={quantity === 0}
                              >
                                <AntDesign
                                  name="minuscircleo"
                                  size={30}
                                  color={"#e6aa6b"}
                                />
                              </TouchableOpacity>

                              <Text className="w-6 text-center text-lg">
                                {quantity}
                              </Text>

                              <TouchableOpacity
                                className="items-center justify-center"
                                onPress={() => handleIncrease(c.name)}
                              >
                                <AntDesign
                                  name="pluscircleo"
                                  size={30}
                                  color={"#e6aa6b"}
                                />
                              </TouchableOpacity>
                            </View>
                          </View>
                        )
                      })}
                </ScrollView>

                {/* ---------- FOOTER / BUTTONS (attach pan handlers here too) ---------- */}
                <View {...panResponder.panHandlers}>
                  <TouchableOpacity
                    disabled={buttonLoading}
                    onPress={async () => {
                      setButtonLoading(true)
                      if (state === "add") {
                        await addItem({
                          dessert: selectedDessert,
                          quantity,
                          loyaltyPointsUsed: type === "points" ? points : null,
                          customisations: customisationQuantity,
                          itemPriceInCents: type === "points" ? 0 : price,
                        })
                      } else {
                        await editItem({
                          id: editId,
                          dessert: selectedDessert,
                          quantity,
                          loyaltyPointsUsed: type === "points" ? points : null,
                          customisations: customisationQuantity,
                          itemPriceInCents: type === "points" ? 0 : price,
                        })
                      }
                      setButtonLoading(false)
                      setModalVisible(false)
                    }}
                    className="bg-primary p-3 mt-3 items-center rounded-lg"
                  >
                    <Text className="text-white font-bold">
                      {state === "add" ? "Add to Cart" : "Edit"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setModalVisible(false)}
                    className="p-3 items-center"
                  >
                    <Text className="text-gray-500">Cancel</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </SafeAreaView>
        )}
      </Animated.View>
    </Modal>
  )
}
