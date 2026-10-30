import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server serve HMR/assets to browser previews reached via 127.0.0.1
  // (random proxy ports). API origin checks live in lib/api.ts, not here.
  allowedDevOrigins: ["127.0.0.1", "zam.tail5ce14e.ts.net"],
  experimental: {
    mcpServer: false,
  },
};

export default nextConfig;
