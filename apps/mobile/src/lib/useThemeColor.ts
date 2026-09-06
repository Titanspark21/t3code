import type { ColorValue } from "react-native";
import { useCSSVariable } from "uniwind";

/** Typed bridge from a Uniwind color variable to a native React Native color. */
export function useThemeColor(variable: `--color-${string}`): ColorValue {
  return useCSSVariable(variable) as string as ColorValue;
}
