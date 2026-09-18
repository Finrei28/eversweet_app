import { Alert, Linking, Platform } from "react-native"

/**
 * Where a customer goes to update.
 *
 * The iOS id is the App Store Connect app id in `eas.json`
 * (`submit.production.ios.ascAppId`); the Android one is `android.package`.
 */
const STORE_URLS = {
  ios: "https://apps.apple.com/app/id6747155337",
  android: "https://play.google.com/store/apps/details?id=nz.co.eversweet",
} as const

export const storeUrl = (): string =>
  Platform.OS === "android" ? STORE_URLS.android : STORE_URLS.ios

/**
 * Opens the store listing for this platform.
 *
 * Deliberately **not** the `Linking.canOpenURL` guard that `store-info.tsx`
 * uses for `tel:` and `mailto:`. Those work because Android keeps them on its
 * default query allowlist; `market://` is not on it, so under Android 11
 * package visibility `canOpenURL("market://…")` answers false unless the
 * manifest declares a matching `<queries>` intent — which this app config has
 * no plugin for. Guarding on it would silently refuse to open Play on every
 * modern Android phone. Both stores claim their https URL as an app link and
 * hand off to the store app themselves, so plain openURL is both simpler and
 * the one that works.
 */
export const openStore = async () => {
  try {
    await Linking.openURL(storeUrl())
  } catch {
    Alert.alert(
      "Couldn't open the store",
      "Please search for Eversweet in the App Store or Google Play.",
    )
  }
}
