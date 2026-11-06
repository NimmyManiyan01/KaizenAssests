import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    pool: "forks",
    maxWorkers: 1,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.tsx"],
    clearMocks: true,
    server: {
      deps: {
        inline: [/html-encoding-sniffer/, /@exodus\/bytes/],
      },
    },
  },
});