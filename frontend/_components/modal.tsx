import { CachedImage } from "@/_components/cachedImage"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  PanResponder,
  Animated,
  Dimensions,
  ActivityIndicator,
} from "react-native"
import Modal from "react-native-modal"
import { CartItem, Dessert, Customisations } from "../utils/types"
import { useCartStore } from "@/store/cart"
import { canAffordRedemption } from "@/store/points"
import { useEffect, useMemo, useState, useRef } from "react"
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context"
import AntDesign from "@expo/vector-icons/AntDesign"
import BouncingLoader from "@/_components/loader"
import { useCustomisationsQuery } from "@/services/queries"
import { formatCurrency } from "@/lib/formatters"
import { useAuth } from "@/store/authProvider"
import {
  calculateBestDiscountedPrice,
  calculateMembershipDiscount,
  calculatePriceAfterMembershipDiscount,
} from "@/lib/priceHelper"

type CustomModalProps = {
  refetchOffers?: () => Promise<void>
  modalVisible: boolean
  setOfferModal?: React.Dispatch<React.SetStateAction<boolean>>
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  selectedDessert: Dessert
  setSelectedDessert?: React.Dispatch<React.SetStateAction<Dessert | null>>
  type: "cents" | "points"
  state?: "add" | "edit"
  offerId?: string | null
  offerItemPrice?: number
  cartItem?: CartItem
}

export default function CustomModal({
  refetchOffers,
  modalVisible,
  setOfferModal,
  setModalVisible,
  setSelectedDessert,
  selectedDessert,
  type,
  state = "add",
  offerId,
  offerItemPrice,
  cartItem,
}: CustomModalProps) {
  const { usersMembership } = useAuth()
  const dessertPriceAfterBestDiscount = calculateBestDiscountedPrice(
    selectedDessert,
    usersMembership,
    offerItemPrice,
  )

  const addTodessertModalTracker = useCartStore(
    (state) => state.addTodessertModalTracker,
  )

  const removeFromDessertModalTracker = useCartStore(
    (state) => state.removeFromDessertModalTracker,
  )

  const editItem = useCartStore((state) => state.editItem)

  const addItem = useCartStore((state) => state.addItem)
  // Cached per dessert, so reopening one the customer already looked at is
  // instant instead of another round trip behind a spinner over the modal.
  const {
    data: availableCustomisations,
    isLoading: availableCustomisationsLoading,
  } = useCustomisationsQuery(selectedDessert?.id)
  const modalIdRef = useRef(Date.now())
  const [customisationPrice, setCustomisationPrice] = useState(
    cartItem?.customisations.reduce(
      (sum, c) => sum + c.priceInCents * c.quantity,
      0,
    ) ?? 0,
  )
  const [buttonLoading, setButtonLoading] = useState(false)
  const [customisations, setCustomisations] = useState<Customisations>([])

  /*
   * These three turn the per-row scans below into O(1) lookups. Rendering the
   * list used to run an O(n×m) filter plus a `.find` for every row, and both
   * ran again on each +/- tap because that sets state and re-renders the modal.
   */
  const availableIds = useMemo(
    () => new Set((availableCustomisations ?? []).map((c) => c.id)),
    [availableCustomisations],
  )

  const dessertIngredientIds = useMemo(
    () => new Set((selectedDessert?.ingredients ?? []).map((i) => i.id)),
    [selectedDessert],
  )

  const quantityById = useMemo(
    () => new Map(customisations.map((item) => [item.id, item.quantity])),
    [customisations],
  )

  const price = selectedDessert.priceInCents
  const points = selectedDessert.priceInLoyaltyPoints

  useEffect(() => {
    if (state === "edit" && cartItem?.customisations) {
      const initialCustomisations = cartItem?.customisations.map((c) => ({
        id: c.id,
        name: c.name,
        chineseName: c.chineseName,
        priceInCents: c.priceInCents,
        discountedAmountInCents: calculateMembershipDiscount(
          c.priceInCents,
          usersMembership,
        ),
        quantity: c.quantity,
      }))

      setCustomisations(initialCustomisations)
    }
  }, [state, cartItem?.customisations])

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
      removeFromDessertModalTracker(modalIdRef.current)
      setModalVisible(false)
      setButtonLoading(false)
      if (setSelectedDessert) {
        setSelectedDessert(null)
      }
      if (setOfferModal) {
        setOfferModal(false)
      }
      if (refetchOffers) {
        refetchOffers()
      }
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
    }),
  ).current

  // --------------------------------------------------------------------

  const buildCustomisation = (
    customisation: { id: string; name: string; chineseName: string; priceInCents: number },
    quantity: number,
  ) => ({
    id: customisation.id,
    name: customisation.name,
    chineseName: customisation.chineseName,
    priceInCents: customisation.priceInCents,
    discountedAmountInCents: calculateMembershipDiscount(
      customisation.priceInCents,
      usersMembership,
    ),
    quantity,
  })

  // Both handlers work out the price change up front and then apply a single
  // state update each. Calling setCustomisationPrice from inside the
  // setCustomisations updater made the updater impure, so StrictMode's double
  // invoke applied the price twice.
  const handleIncrease = (ingredientId: string) => {
    const customisation = availableCustomisations?.find(
      (c) => c.id === ingredientId,
    )

    if (!customisation) return

    const existingItem = customisations.find((item) => item.id === ingredientId)

    if (!existingItem) {
      // First time this topping is added on top of the dessert's defaults.
      setCustomisationPrice((prev) => prev + customisation.priceInCents)
      setCustomisations((prev) => [...prev, buildCustomisation(customisation, 1)])
      return
    }

    if (existingItem.quantity === 0) {
      // The ingredient was explicitly removed; putting it back restores the
      // dessert's default, which costs nothing.
      setCustomisations((prev) =>
        prev.filter((item) => item.id !== ingredientId),
      )
      return
    }

    setCustomisationPrice((prev) => prev + customisation.priceInCents)
    setCustomisations((prev) =>
      prev.map((item) =>
        item.id === ingredientId
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      ),
    )
  }

  const handleDecrease = (ingredientId: string) => {
    const customisation = availableCustomisations?.find(
      (c) => c.id === ingredientId,
    )
    if (!customisation) return

    const existingItem = customisations.find((item) => item.id === ingredientId)

    if (!existingItem) {
      // Removing an ingredient the dessert includes by default: tracked as an
      // explicit 0 so the order knows to leave it out. Nothing to refund.
      setCustomisations((prev) => [...prev, buildCustomisation(customisation, 0)])
      return
    }

    if (existingItem.quantity <= 0) return

    // Every step down from a charged quantity refunds exactly one unit.
    setCustomisationPrice((prev) =>
      Math.max(0, prev - customisation.priceInCents),
    )
    setCustomisations((prev) =>
      prev.flatMap((item) => {
        if (item.id !== ingredientId) return [item]
        const newQuantity = item.quantity - 1
        // Back to zero extras means back to the dessert's default state.
        return newQuantity === 0 ? [] : [{ ...item, quantity: newQuantity }]
      }),
    )
  }

  const insets = useSafeAreaInsets()
  const pricebeforeDiscount =
    Number(selectedDessert.priceInCents + customisationPrice) / 100
  const priceAfterDiscount = // if current item is a cart item (edit mode) then show cart item price minus the discounts (including customisations) else return dessert after discount (including offer price)
    Number(
      (!cartItem
        ? dessertPriceAfterBestDiscount
        : cartItem.itemPriceInCents - cartItem.discountedAmountInCents) +
        calculatePriceAfterMembershipDiscount(
          customisationPrice,
          usersMembership,
        ),
    ) / 100

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

                    <CachedImage
                      uri={selectedDessert.imagePath}
                      style={{ width: "100%", height: 200, borderRadius: 10 }}
                      resizeMode="contain"
                      className="px-3"
                    />
                    <View className="px-3">
                      <Text className="mt-5 ">
                        Ingredients:{" "}
                        {selectedDessert.ingredients
                          .map((i) => i.name)
                          .join(", ")}
                      </Text>
                      <View className="flex flex-row items-center mt-2">
                        <Text className="font-semibold text-lg">Price: </Text>
                        {type === "cents" ? (
                          usersMembership?.isActive ||
                          selectedDessert.promo?.isActive ? (
                            <>
                              <View className="flex flex-row items-center gap-1">
                                <Text className="text-red-600 line-through text-sm">
                                  {formatCurrency(pricebeforeDiscount)}
                                </Text>
                                {offerId ? (
                                  <Text className="font-bold">
                                    {formatCurrency(priceAfterDiscount)}
                                  </Text>
                                ) : (
                                  <Text className="font-bold">
                                    {formatCurrency(priceAfterDiscount)}
                                  </Text>
                                )}
                              </View>
                            </>
                          ) : (
                            <Text className="font-bold">
                              {formatCurrency(priceAfterDiscount)}
                            </Text>
                          )
                        ) : (
                          <Text className="font-bold">{points} points</Text>
                        )}
                      </View>
                    </View>
                  </View>
                </View>

                {/* ---------- SCROLLABLE CUSTOMISATIONS ---------- */}
                <ScrollView
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedDessert.ingredients
                    .filter((ingredient) => availableIds.has(ingredient.id))
                    .map((ingredient) => {
                      const toppingQuantity = quantityById.get(ingredient.id)

                      const quantity =
                        toppingQuantity === undefined
                          ? 1
                          : toppingQuantity === 0
                            ? 0
                            : toppingQuantity + 1

                      return (
                        <View
                          key={ingredient.id}
                          className="flex-row justify-between items-center rounded-lg bg-slate-50 p-3"
                        >
                          <View className="flex-row flex-1 items-center gap-4">
                            <View>
                              <Text className="text-lg">
                                {ingredient.name}{" "}
                              </Text>
                              <Text className="text-sm text-muted-foreground">
                                {formatCurrency(ingredient.priceInCents / 100)}
                              </Text>
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
                              onPress={() => handleDecrease(ingredient.id)}
                              disabled={quantity === 0}
                            >
                              <AntDesign
                                name="minus-circle"
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
                              onPress={() => handleIncrease(ingredient.id)}
                            >
                              <AntDesign
                                name="plus-circle"
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
                      ?.filter((c) => !dessertIngredientIds.has(c.id))
                      .map((c) => {
                        const toppingQuantity = quantityById.get(c.id)

                        const quantity =
                          toppingQuantity === undefined
                            ? 0
                            : toppingQuantity >= 1
                              ? toppingQuantity
                              : 0

                        return (
                          <View
                            key={c.id}
                            className="flex-row justify-between items-center rounded-lg bg-slate-50 p-3"
                          >
                            <View className="flex-row flex-1 items-center gap-4">
                              <View>
                                <Text className="text-lg">{c.name}</Text>
                                <Text className="text-sm text-muted-foreground">
                                  {formatCurrency(c.priceInCents / 100)}
                                </Text>
                              </View>
                            </View>

                            <View className="flex-row items-center gap-3">
                              <TouchableOpacity
                                className="items-center justify-center"
                                onPress={() => handleDecrease(c.id)}
                                disabled={quantity === 0}
                              >
                                <AntDesign
                                  name="minus-circle"
                                  size={30}
                                  color={"#e6aa6b"}
                                />
                              </TouchableOpacity>

                              <Text className="w-6 text-center text-lg">
                                {quantity}
                              </Text>

                              <TouchableOpacity
                                className="items-center justify-center"
                                onPress={() => handleIncrease(c.id)}
                              >
                                <AntDesign
                                  name="plus-circle"
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
                    onPress={() => {
                      const currentModalId = modalIdRef.current
                      setButtonLoading(true)
                      addTodessertModalTracker(currentModalId)

                      const isEdit = state === "edit" && !!cartItem

                      const submit = isEdit
                        ? editItem({
                            id: cartItem!.id,
                            dessert: selectedDessert,
                            quantity: 1,
                            loyaltyPointsUsed:
                              type === "points" ? points : null,
                            customisations: customisations,
                            itemPriceInCents: type === "points" ? 0 : price,
                            offerId: offerId ? offerId : null,
                            discountedAmountInCents: 0,
                          })
                        : addItem(
                            {
                              dessert: selectedDessert,
                              quantity: 1,
                              loyaltyPointsUsed:
                                type === "points" ? points : null,
                              customisations: customisations,
                              itemPriceInCents: type === "points" ? 0 : price,
                              offerId: offerId ? offerId : null,
                            },
                            usersMembership,
                          )

                      // A plain add lands in the cart locally the moment it
                      // is requested, so there is nothing here worth waiting
                      // for — and waiting was the whole of the four to five
                      // seconds this button used to take.
                      //
                      // A redemption goes the same way when this device can see
                      // the points are there. When it cannot, the modal keeps
                      // its spinner and the customer reads the server's answer
                      // before it closes. Offers always wait: their refusals
                      // turn on a usage limit and an audience that only the
                      // server knows.
                      const closesImmediately =
                        !isEdit &&
                        !offerId &&
                        (type !== "points" || canAffordRedemption(points))

                      if (closesImmediately) {
                        void submit
                        closeWithAnimation()
                        return
                      }

                      void submit.finally(() => {
                        const modalExists = useCartStore
                          .getState()
                          .dessertModalTracker.includes(modalIdRef.current)

                        if (modalExists) {
                          closeWithAnimation()
                        }
                      })
                    }}
                    className="bg-primary p-3 mt-3 items-center rounded-lg"
                  >
                    {buttonLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-white font-bold">
                        {state === "add" ? "Add to Cart" : "Edit"}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => closeWithAnimation()}
                    className="p-3 items-center"
                    disabled={buttonLoading}
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
