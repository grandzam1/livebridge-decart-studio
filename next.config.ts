import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    mcpServer: false,
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "timid-flint-mutt.ngrok-free.dev",
  ],
};

export default nextConfig;