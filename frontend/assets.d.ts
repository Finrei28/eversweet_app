// Static image imports. Metro turns these into asset references at build time,
// but TypeScript needs telling that the modules exist. expo/types does not
// declare them, and expo-env.d.ts is generated, so this lives on its own.
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native"
  const content: ImageSourcePropType
  export default content
}

declare module "*.jpg" {
  import type { ImageSourcePropType } from "react-native"
  const content: ImageSourcePropType
  export default content
}
