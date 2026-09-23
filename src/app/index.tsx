import { useAuth, useClerk, useUser } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      Sentry.captureException(err);
      setSigningOut(false);
    }
  };

  // Temporary placeholder — the real home screen isn't built yet.
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-lg font-semibold">
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
        {signingOut ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text className="text-[15px] font-medium text-white">Sign out</Text>
        )}
      </Pressable>
    </View>
  );
}
