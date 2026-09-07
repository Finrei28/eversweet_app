// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config")
const expoConfig = require("eslint-config-expo/flat")

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // Guards against apostrophes and quotes being ambiguous in HTML markup.
      // This app renders to native <Text>, not the DOM, so the only effect is
      // forcing entity escapes into ordinary prose ("You don&apos;t have any
      // orders yet"), which is harder to read for no safety gain.
      "react/no-unescaped-entities": "off",
    },
  },
])
