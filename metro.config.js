const { withNativeWind } = require('nativewind/metro');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname, {
  autoWrapExpoRouterErrorBoundary: true,
  // Shows real component names (MyCard, MyButton) in Session Replay and
  // traces instead of generic View > Touchable > View.
  annotateReactComponents: true,
})

module.exports = withNativeWind(config, { input: './src/global.css' })