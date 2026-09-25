import { View, type ViewStyle } from "react-native";

// Drawn, not a font glyph — thin angle-quote/arrow characters render too
// faint on Android. Classic CSS "border arrow" trick: a square with two
// adjacent borders, rotated, forms a chevron pointing any direction.
const ROTATIONS = {
  left: "135deg",
  right: "-45deg",
  up: "-135deg",
  down: "45deg",
} as const;

/** Draws a directional chevron with borders for consistent native rendering. */
export function Chevron({
  direction,
  color = "#0A0A0A",
  size = 9,
  style,
}: {
  direction: keyof typeof ROTATIONS;
  color?: string;
  size?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderColor: color,
          borderRightWidth: 2,
          borderBottomWidth: 2,
          transform: [{ rotate: ROTATIONS[direction] }],
        },
        style,
      ]}
    />
  );
}
