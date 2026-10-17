import { openUrl } from "@gravity/plugin/client/react-native";
import { Linking, Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window: { open(url: string, target: string, features: string): unknown };

/** Opens a link in the user's browser rather than inside Gravity. */
export async function openExternal(url: string): Promise<void> {
  // Apps released before `openUrl` do not provide it. There, `window.open` in the
  // desktop app opens an Electron window instead of the default browser.
  if (typeof (openUrl as unknown) === "function") {
    await openUrl(url);
    return;
  }
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
