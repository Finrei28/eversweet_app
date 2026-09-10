import React from "react"
import Svg, { Path } from "react-native-svg"

/**
 * The Eversweet logo has two four-pointed sparkle diamonds floating beside the
 * dessert bowl. This is that sparkle, redrawn as an icon so loyalty points stop
 * reading as a bare number.
 *
 * Module scope: the path never changes, so there is no reason to rebuild the
 * string on every render of the six screens that show a points value.
 *
 * Geometry is a 24x24 box, centre (12,12), radius 10.6, with each bezier's
 * control points pulled to 58% of the arm radius. That 58% is what gives the
 * plump, gently concave sides of the logo's sparkle rather than the sharp
 * needle points of a generic four-point star.
 *
 * The radius is 10.6 and not 12 so that the outline variant's stroke — half of
 * which sits outside the path — still lands inside the viewBox. At radius 12
 * the four points clipped flat.
 */
const SPARKLE_PATH =
  "M 12 1.4 C 12 5.85, 18.15 12, 22.6 12 C 18.15 12, 12 18.15, 12 22.6 C 12 18.15, 5.85 12, 1.4 12 C 5.85 12, 12 5.85, 12 1.4 Z"

/** The logo's own line colour, sampled from the artwork. Deliberately browner
 * than the UI's `primary` (#e6aa6b): the points number is drawn in primary, and
 * the darker icon beside it keeps the number the hero instead of blending. */
const LOGO_BROWN = "#B97B53"

/** Tuned against the tab bar's ICON_SIZE of 22, where the sibling icons sit. At
 * 2 the outline goes weedy next to them; at 2.5 the concave sides start closing
 * up the middle. Anything above ~2.8 would push the stroke past the viewBox. */
const OUTLINE_STROKE_WIDTH = 2.2

type SweetPointIconProps = {
  size?: number
  /** Pass "#FFFFFF" on the two surfaces that draw points white on bg-primary —
   * the dessert card button and the leaderboard rank footer. */
  color?: string
  /** "outline" exists for the Rewards tab's unfocused state. It is not legible
   * below about 20px, so inline points values should stay "filled". */
  variant?: "filled" | "outline"
  /** Screens that drop the visible word "points" rely on this to keep the value
   * meaningful to a screen reader. Pass undefined where the word is still on
   * screen, so it is not announced twice. */
  accessibilityLabel?: string
}

export const SweetPointIcon = React.memo(
  ({
    size = 16,
    color = LOGO_BROWN,
    variant = "filled",
    accessibilityLabel,
  }: SweetPointIconProps) => (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Path
        d={SPARKLE_PATH}
        fill={variant === "filled" ? color : "none"}
        stroke={variant === "outline" ? color : undefined}
        strokeWidth={variant === "outline" ? OUTLINE_STROKE_WIDTH : undefined}
        strokeLinejoin="round"
      />
    </Svg>
  ),
)

SweetPointIcon.displayName = "SweetPointIcon"
