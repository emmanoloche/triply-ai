import { useAuth, useUser } from "@clerk/expo";
import { Redirect } from "expo-router";
import { Text, View } from "react-native";

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  // Temporary placeholder — the real home screen isn't built yet.
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-lg font-semibold">
        Signed in as {user?.primaryEmailAddress?.emailAddress ?? user?.id}
      </Text>
    </View>
  );
}
