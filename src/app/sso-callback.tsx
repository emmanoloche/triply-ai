import { Redirect } from "expo-router";

/**
 * Clerk's browser sign-in (useSSO) returns to the app at ".../sso-callback".
 * Clerk finishes the sign-in itself; this route only exists so Expo Router has
 * somewhere to land instead of its "Unmatched Route" page. From here the user
 * goes to the home tabs, which send anyone not signed in back to sign-in.
 */
export default function SsoCallback() {
  return <Redirect href="/" />;
}
