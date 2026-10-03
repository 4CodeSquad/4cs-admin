import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // exFAT: macOS writes ._* sidecars that match the include glob.
    exclude: ["**/._*", "**/node_modules/**"],
    // Tests share one database; run files one after another.
    fileParallelism: false,
    globalSetup: "tests/global-setup.ts",
    testTimeout: 20000,
  },
});
