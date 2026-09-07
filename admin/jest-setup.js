/**
 * AsyncStorage is a native module, so importing it under Jest throws rather
 * than returning something inert. The package ships a mock for exactly this;
 * registering it here means any test that pulls in a store or service does not
 * have to know it is a dependency.
 */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
