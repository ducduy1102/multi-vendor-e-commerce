import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    // Ảnh variant upload qua Cloudinary (Week4.md Bước 1.11/3.8) — next/image
    // chặn domain lạ mặc định, phải whitelist tường minh.
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
};

export default withNextIntl(nextConfig);
