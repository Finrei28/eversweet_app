import { Platform } from "react-native"

/**
 * The tab bar's height, set in app/(tabs)/_layout.tsx. The toast host reads it too,
 * to sit a toast just above the bar on tab screens.
 */
export const TAB_BAR_HEIGHT = Platform.OS === "ios" ? 88 : 64
