import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // next-intl (qua node_modules symlink của pnpm) tự import "next/navigation"
    // nội bộ — Vite mặc định external hoá package đã build sẵn, gây lỗi
    // resolve subpath export "next/navigation" xuyên qua symlink. Bắt Vite tự
    // xử lý/transform next-intl thay vì coi là external để tránh lỗi đó.
    server: {
      deps: {
        inline: ["next-intl", "use-intl"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
