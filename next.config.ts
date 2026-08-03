import type { NextConfig } from "next";

const allowedServerActionOrigins = process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins,
    },
  },
};

export default nextConfig;
