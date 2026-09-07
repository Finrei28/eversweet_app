import { Alert } from "react-native"
import { PaymentSheet, useStripe } from "@stripe/stripe-react-native"
import {
  createSetupIntent,
  setCardForMembershipPayments,
} from "@/services/stripe-api"

/**
 * Opens the Stripe Payment Sheet to save a card.
 * @param stripeHooks - Object containing `initPaymentSheet` and `presentPaymentSheet` from `useStripe()`.
 * @param refetchCards - Callback to refresh the list of saved cards after success/cancellation.
 */

/**
 * Eversweet's palette applied to the Stripe sheet, so saving a card does not
 * drop the customer onto a stock white form. Values are the tokens from
 * tailwind.config.ts rather than fresh colours, so the sheet moves with the
 * theme instead of drifting from it.
 *
 * No `font` block: the previous one named "AvenirNext-Regular" / "avenirnext
 * regular", and only SpaceMono is bundled in assets/fonts, so it resolved to
 * nothing on Android. Stripe's platform default is used until a brand font is
 * actually shipped with the app.
 */
const eversweetAppearance: PaymentSheet.AppearanceParams = {
  colors: {
    primary: "#e6aa6b", // primary.DEFAULT
    background: "#fcf8f3", // background
    componentBackground: "#ffffff", // card.DEFAULT
    componentBorder: "#e5e5e5", // border
    componentDivider: "#e5e5e5",
    primaryText: "#0a0a0a", // foreground
    secondaryText: "#737373", // muted.foreground
    componentText: "#0a0a0a",
    placeholderText: "#737373",
    icon: "#737373",
    error: "#ef4444", // destructive.DEFAULT
  },
  shapes: {
    // 8px is the app's --radius (0.5rem), the same corner its cards and inputs
    // use, so the sheet's fields match the ones behind it.
    borderRadius: 8,
    borderWidth: 1,
  },
  primaryButton: {
    colors: {
      background: "#e6aa6b",
      text: "#ffffff",
      border: "#e6aa6b",
    },
    shapes: {
      // Matches the rounded-lg on "Place Order" and "Add New Card".
      borderRadius: 8,
    },
  },
}

export const openPaymentSheetForSetup = async (
  stripeHooks: Pick<
    ReturnType<typeof useStripe>,
    "initPaymentSheet" | "presentPaymentSheet"
  >,
  refetchCards: () => Promise<void>,
  isMembershipActive: boolean,
) => {
  const { initPaymentSheet, presentPaymentSheet } = stripeHooks
  try {
    // Create setup intent + ephemeral key on your backend
    const { setupIntent, ephemeralKey, customer, setupIntentId } =
      await createSetupIntent()

    if (!setupIntent || !ephemeralKey || !customer) {
      throw new Error("Invalid Stripe setup intent response.")
    }

    // Initialize the payment sheet
    const { error: initError } = await initPaymentSheet({
      customerId: customer,
      customerEphemeralKeySecret: ephemeralKey,
      setupIntentClientSecret: setupIntent,
      merchantDisplayName: "Eversweet",
      allowsDelayedPaymentMethods: false,
      returnURL: "eversweet://stripe-redirect",
      appearance: eversweetAppearance,
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
      if (isMembershipActive) {
        Alert.alert(
          "Success, card added successfully",
          "Use this card for future membership payments?",
          [
            {
              text: "No",
              style: "destructive",
            },
            {
              text: "Yes",
              style: "default",
              onPress: async () => {
                try {
                  await setCardForMembershipPayments(setupIntentId)
                  // Refresh the list after deletion
                  refetchCards()
                } catch (error) {
                  console.error("Failed to save card for membership:", error)
                  Alert.alert("Error", "Failed to save card for membership")
                }
              },
            },
          ],
        )
      } else {
        Alert.alert("Success", "Card added successfully.")
      }

      refetchCards()
    }
  } catch (err: any) {
    console.error(err)
    Alert.alert("Error", err.message || "Failed to save card. Try again.")
  }
}
