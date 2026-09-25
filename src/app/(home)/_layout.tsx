import { useAuth } from "@clerk/expo";
import { Redirect, usePathname } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";

const BLUE = "#076FFA";

/** Requires sign-in before showing the app's native home tabs. */
export default function HomeLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  // The Assistant is a chat-only screen (like ChatGPT): no tab bar, just the
  // conversation and the keyboard. It has its own back button.
  const onAssistant = usePathname() === "/assistant";

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <NativeTabs
      hidden={onAssistant}
      iconColor={{ selected: BLUE }}
      labelStyle={{ selected: { color: BLUE } }}
      // Android's Material bottom nav only shows the label of the selected
      // tab once there are 4+ items ("auto" mode) — force all 4 to always
      // show their label, matching the design.
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assistant">
        <NativeTabs.Trigger.Label>Assistant</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map.fill" md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
