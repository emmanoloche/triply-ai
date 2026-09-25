import { useClerk, useUser } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

// Placeholder — UI design for this tab comes from design/profile-screen-ui-design1.png
// and profile-screen-ui-design2.png, not built yet (see plan.md Phase 4). Sign-out is
// carried over here from the old temporary root screen so it isn't lost.
export default function Profile() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      Sentry.captureException(err);
      setSigningOut(false);
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-lg font-semibold text-[#0A0A0A]">
        Signed in as {user?.primaryEmailAddress?.emailAddress ?? user?.id}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        disabled={signingOut}
        onPress={handleSignOut}
        className={`mt-6 h-11 items-center justify-center rounded-full bg-[#076FFA] px-6 ${
          signingOut ? "opacity-60" : ""
        }`}
      >
        {signingOut ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-[15px] font-medium text-white">Sign out</Text>}
      </Pressable>
    </View>
  );
}
