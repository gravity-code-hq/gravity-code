import Svg, { Path } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";

export const GRAVITY_LOGO_PATH = "M403 366 L602 543 L403 698";
export const GRAVITY_LOGO_VIEW_BOX = "260 260 504 504";
export const GRAVITY_LOGO_STROKE_WIDTH = 100;

interface GravityLogoProps {
  size?: number;
  color?: string;
}

const ThemedSvg = withUnistyles(Svg, (theme) => ({ color: theme.colors.foreground }));

export function GravityLogo({ size = 64, color }: GravityLogoProps) {
  return (
    <ThemedSvg width={size} height={size} viewBox={GRAVITY_LOGO_VIEW_BOX} fill="none">
      <Path
        d={GRAVITY_LOGO_PATH}
        stroke={color ?? "currentColor"}
        strokeWidth={GRAVITY_LOGO_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ThemedSvg>
  );
}
