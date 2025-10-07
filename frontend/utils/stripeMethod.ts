import { Alert, Platform } from "react-native"
import { useStripe } from "@stripe/stripe-react-native"
import { createSetupIntent } from "@/services/stripe-api"

/**
 * Opens the Stripe Payment Sheet to save a card.
 * @param stripeHooks - Object containing `initPaymentSheet` and `presentPaymentSheet` from `useStripe()`.
 * @param refetchCards - Callback to refresh the list of saved cards after success/cancellation.
 */

const customAppearance = {
  font: {
    family:
      Platform.OS === "android" ? "avenirnextregular" : "AvenirNext-Regular",
  },
  shapes: {
    borderRadius: 12,
    borderWidth: 0.5,
  },
  primaryButton: {
    shapes: {
      borderRadius: 20,
    },
  },
  colors: {
    primary: "#fcfdff",
    background: "#ffffff",
    componentBackground: "#f3f8fa",
    componentBorder: "#f3f8fa",
    componentDivider: "#000000",
    primaryText: "#000000",
    secondaryText: "#000000",
    componentText: "#000000",
    placeholderText: "#73757b",
  },
}

export const openPaymentSheetForSetup = async (
  stripeHooks: Pick<
    ReturnType<typeof useStripe>,
    "initPaymentSheet" | "presentPaymentSheet"
  >,
  refetchCards: () => void
) => {
  const { initPaymentSheet, presentPaymentSheet } = stripeHooks
  try {
    // Create setup intent + ephemeral key on your backend
    const { setupIntent, ephemeralKey, customer } = await createSetupIntent()

    // Initialize the payment sheet
    const { error: initError } = await initPaymentSheet({
      customerId: customer,
      customerEphemeralKeySecret: ephemeralKey,
      setupIntentClientSecret: setupIntent,
      merchantDisplayName: "eversweet",
      allowsDelayedPaymentMethods: false,
      returnURL: "eversweet://stripe-redirect",
    })
    if (initError) throw initError

    // Present the payment sheet
    const result = await presentPaymentSheet()
    if (result.error) {
      if (result.error.message === "The payment has been canceled") {
        refetchCards()
        return
      }
      Alert.alert(result.error.message)
      refetchCards()
    } else {
      Alert.alert("Success", "Card added successfully.")
      refetchCards()
    }
  } catch (err: any) {
    console.error(err)
    Alert.alert("Error", err.message || "Failed to save card. Try again.")
  }
}
