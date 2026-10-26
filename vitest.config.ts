import { defineConfig } from "vitest/config";

// Test gọi Google thật nằm trong test/live, chỉ chạy bằng `npm run test:google` (vitest.live.config.ts).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/live/**", "node_modules/**"],
  },
});
