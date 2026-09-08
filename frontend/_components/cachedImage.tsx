import React from "react"
import { Image as ExpoImage, ImageContentFit, ImageStyle } from "expo-image"
import { StyleProp } from "react-native"
import { cssInterop } from "nativewind"

/**
 * NativeWind only rewrites `className` for components it knows about, and
 * expo-image is not one of them. Without this every `className` on an image
 * below would silently do nothing and the layout would collapse.
 */
cssInterop(ExpoImage, { className: "style" })

type CachedImageProps = {
  /** Remote URL. Undefined renders the placeholder background alone. */
  uri: string | undefined
  className?: string
  style?: StyleProp<ImageStyle>
  /** Accepted in React Native's spelling and mapped, so call sites read the
   * same as they did with the built-in Image. */
  resizeMode?: "cover" | "contain" | "center" | "stretch"
  alt?: string
  accessibilityLabel?: string
  accessibilityHint?: string
  /** Keeps the right image with the right row as a virtualised list recycles
   * its cells; without it a cell can briefly show the previous item's photo. */
  recyclingKey?: string
}

/**
 * The single place remote images are loaded.
 *
 * React Native's Image exposes no cache policy, so the same dessert photos were
 * fetched again on every screen that showed them. expo-image keeps a memory and
 * disk cache and cross-fades in, which matters most on the menu and order
 * history, where the same images recur constantly.
 */
export const CachedImage = React.memo(
  ({
    uri,
    className,
    style,
    resizeMode = "cover",
    alt,
    accessibilityLabel,
    accessibilityHint,
    recyclingKey,
  }: CachedImageProps) => (
    <ExpoImage
      className={className}
      style={style}
      source={uri ? { uri } : undefined}
      contentFit={resizeMode as ImageContentFit}
      cachePolicy="memory-disk"
      transition={200}
      recyclingKey={recyclingKey ?? uri}
      alt={alt}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel ?? alt}
      accessibilityHint={accessibilityHint}
    />
  ),
)

CachedImage.displayName = "CachedImage"
