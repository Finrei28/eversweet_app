import { View, Platform } from "react-native"
import EversweetLogo from "./eversweetLogo"

export default function PageHeader() {
  return (
    <View
      className={`absolute top-0 left-0 right-0 z-10 w-full bg-secondary items-center justify-end ${
        Platform.OS === "ios" ? "h-32 pb-4" : "h-24 pb-3"
      }`}
    >
      {/* justify-end plus the bottom padding above, rather than a top margin on
          the image: the logo then sits the same distance above the content on
          both platforms, whatever the status bar height turns out to be. */}
      <EversweetLogo height={44} />
    </View>
  )
}
