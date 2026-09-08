const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")

const config = getDefaultConfig(__dirname)

/**
 * Off by default in Expo's config. Turning it on defers each module's `require`
 * to the point of first use, so heavyweight modules that a given screen never
 * touches — Stripe, the carousel, the API surface — stop being evaluated during
 * cold start.
 */
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: true,
    inlineRequires: true,
  },
})

module.exports = withNativeWind(config, {
  input: "./app/global.css",
})
