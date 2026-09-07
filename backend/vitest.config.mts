import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Integration tests share one database and truncate between cases, so
    // running files side by side would have them clearing each other's rows
    // mid-test. Cases within a file still run in order.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
