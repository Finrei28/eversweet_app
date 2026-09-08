import { Image } from "react-native"

// Bundled rather than fetched from EXPO_PUBLIC_LOGO_URL: the headers are the
// first thing drawn on every screen, and a remote logo leaves a blank bar
// whenever the network is slow, the variable is unset, or the host is down.
//
// This is transparent_logo_1024.png trimmed to the artwork itself. The original
// is a 1024x1024 canvas whose mark occupies only the middle third, so anything
// sizing it by height rendered it about a third as large as the space allowed.
import logo from "../assets/images/eversweet_logo_header.png"

/** The trimmed artwork's own proportions, so it is never stretched. */
const LOGO_ASPECT_RATIO = 841 / 319

/**
 * The wordmark, sized by height and centred by its container.
 *
 * `resizeMode="contain"` matters: the default is "cover", which cropped the
 * mark to whatever box it was given — that is what made it hard to read in
 * both headers.
 *
 * `height` is the height of the mark itself, not of a box it sits inside. The
 * untrimmed asset only filled about 29% of its square canvas, so a height that
 * looked right for that file draws roughly three times larger here. 28pt is a
 * standard nav bar logo; the old header worked out to about 14pt of visible
 * artwork, which was too small to read.
 */
export default function EversweetLogo({ height = 28 }: { height?: number }) {
  return (
    <Image
      source={logo}
      resizeMode="contain"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Eversweet"
      style={{ height, aspectRatio: LOGO_ASPECT_RATIO }}
    />
  )
}
