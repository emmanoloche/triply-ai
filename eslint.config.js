// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // eslint-import-resolver-typescript (the resolver behind the "@/*" alias,
    // set up by eslint-config-expo) doesn't read tsconfig's `moduleSuffixes`
    // on its own, so it can't find TripMap.native.tsx / TripMap.web.tsx from
    // a bare "@/components/TripMap" import. Its own docs recommend exactly
    // this override for React Native's platform-split file convention.
    settings: {
      "import/resolver": {
        typescript: {
          extensions: [
            ".native.tsx", ".native.ts", ".native.jsx", ".native.js",
            ".web.tsx", ".web.ts", ".web.jsx", ".web.js",
            ".tsx", ".ts", ".jsx", ".js", ".json",
          ],
        },
      },
    },
  },
]);
