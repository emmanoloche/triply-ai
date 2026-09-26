import { useSSO } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { Image, type ImageSource } from "expo-image";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type OAuthStrategy = "oauth_google" | "oauth_apple";

const BACKGROUND = require("../../../assets/images/auth-screen-bg.png");
const GOOGLE_ICON = require("../../../assets/icons/google.svg");
const APPLE_ICON = require("../../../assets/icons/apple.svg");

const MAX_SCREEN_WIDTH = 430;
const BACKGROUND_ASPECT = 853 / 1844;
const NAVY = "rgb(0, 36, 51)";
const GRADIENT =
  "linear-gradient(to bottom," +
  " rgba(0,38,53,0) 48%," +
  " rgba(0,38,53,0.2) 55%," +
  " rgba(0,38,53,0.34) 60%," +
  " rgba(0,38,53,0.43) 66%," +
  " rgba(0,38,53,0.53) 71%," +
  " rgba(0,38,53,0.62) 77%," +
  " rgba(0,38,53,0.72) 82%," +
  " rgba(0,38,53,0.86) 88%," +
  ` ${NAVY} 93%,` +
  ` ${NAVY} 100%)`;
const GRADIENT_STYLE =
  Platform.OS === "web"
    ? { backgroundImage: GRADIENT }
    : { experimental_backgroundImage: GRADIENT };

type AuthButtonProps = {
  label: string;
  icon: ImageSource;
  iconWidth: number;
  iconHeight: number;
  iconLeft: number;
  labelGap: number;
  variant: "primary" | "light";
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

function AuthButton({
  label,
  icon,
  iconWidth,
  iconHeight,
  iconLeft,
  labelGap,
  variant,
  loading,
  disabled,
  onPress,
}: AuthButtonProps) {
  const primary = variant === "primary";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      className={`h-[49.5px] flex-row items-center rounded-full active:opacity-90 ${
        primary ? "bg-[#076FFA]" : "bg-[#FEFEFE]"
      } ${disabled ? "opacity-60" : ""}`}
      style={primary ? undefined : { boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.12)" }}
    >
      {loading ? (
        <View className="w-full items-center">
          <ActivityIndicator color={primary ? "#FFFFFF" : "#050505"} />
        </View>
      ) : (
        <>
          <Image
            source={icon}
            contentFit="contain"
            style={{ width: iconWidth, height: iconHeight, marginLeft: iconLeft }}
          />
          <Text
            className={`text-[15px] ${primary ? "font-normal text-white" : "font-medium text-[#050505]"}`}
            style={{ marginLeft: labelGap }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export default function SignIn() {
  const { width: windowWidth, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [loadingStrategy, setLoadingStrategy] = useState<OAuthStrategy | null>(null);

  const handleSSO = async (strategy: OAuthStrategy) => {
    if (loadingStrategy) return;
    setLoadingStrategy(strategy);
    try {
      const { createdSessionId, setActive, signUp } = await startSSOFlow({ strategy });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        Sentry.logger.info("User signed in", { auth_strategy: strategy });
        router.replace("/");
      } else if (signUp?.status === "missing_requirements") {
        Sentry.captureMessage(`SSO sign-up missing_requirements for ${strategy}`, "warning");
        Sentry.logger.warn("SSO sign-up missing requirements", { auth_strategy: strategy });
      }
      // No createdSessionId and no missing requirements → the user cancelled; do nothing.
    } catch (err) {
      Sentry.captureException(err);
      Sentry.logger.error("SSO sign-in failed", {
        auth_strategy: strategy,
        error_message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingStrategy(null);
    }
  };

  const width = Math.min(windowWidth, MAX_SCREEN_WIDTH);
  const imageTop = -0.1262 * width;
  const imageWidth = Math.max(width, (height - imageTop) * BACKGROUND_ASPECT);
  const imageHeight = imageWidth / BACKGROUND_ASPECT;
  const imageLeft = (width - imageWidth) / 2;
  const bottomPadding = Math.max(insets.bottom + 10, 44.4);

  return (
    <View className="flex-1 items-center bg-[#0B1218]">
      <StatusBar style="light" />

      <View
        className="w-full flex-1 overflow-hidden"
        style={{ maxWidth: MAX_SCREEN_WIDTH, backgroundColor: NAVY }}
      >
        <Image
          source={BACKGROUND}
          contentFit="cover"
          style={{
            position: "absolute",
            left: imageLeft,
            top: imageTop,
            width: imageWidth,
            height: imageHeight,
          }}
        />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, GRADIENT_STYLE]}
        />

        <View className="flex-1 justify-end px-[31.5px]" style={{ paddingBottom: bottomPadding }}>
          <View className="items-center" style={{ marginHorizontal: -15.5 }}>
            <Text
              className="text-center text-[32px] font-semibold leading-10 tracking-[-0.5px] text-white"
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              Your next
            </Text>
            <Text
              className="text-center text-[32px] font-semibold leading-10 tracking-[-0.5px] text-white"
              style={{ transform: [{ translateX: 5.5 }] }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              adventure starts here
            </Text>
          </View>

          <View className="mt-[23.9px]">
            <AuthButton
              label="Continue with Google"
              icon={GOOGLE_ICON}
              iconWidth={25}
              iconHeight={26}
              iconLeft={47.2}
              labelGap={33}
              variant="light"
              loading={loadingStrategy === "oauth_google"}
              disabled={loadingStrategy !== null && loadingStrategy !== "oauth_google"}
              onPress={() => handleSSO("oauth_google")}
            />
            <View className="mt-[13.1px]">
              <AuthButton
                label="Continue with Apple"
                icon={APPLE_ICON}
                iconWidth={21.4}
                iconHeight={26.4}
                iconLeft={49}
                labelGap={35.3}
                variant="light"
                loading={loadingStrategy === "oauth_apple"}
                disabled={loadingStrategy !== null && loadingStrategy !== "oauth_apple"}
                onPress={() => handleSSO("oauth_apple")}
              />
            </View>
          </View>

          <Text className="mt-[26.2px] text-center text-[12px] font-normal leading-[18px] text-white">
            By continuing, you agree to our{"\n"}
            <Text className="text-[#2094FF]">Terms of Service</Text> and{" "}
            <Text className="text-[#2094FF]">Privacy Policy</Text>
          </Text>
        </View>
      </View>
    </View>
  );
}
