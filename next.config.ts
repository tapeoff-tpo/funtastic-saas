import type { NextConfig } from "next";

const allowedServerActionOrigins = process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // The quality-PDF renderer loads a platform-specific native canvas binary at runtime.
  serverExternalPackages: ['@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/operations/coupang-registration/extension': ['./tools/browser-extensions/funtastic-coupang-registration/**/*'],
  },
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Keep recently visited dynamic screens warm long enough for practical tab switching,
    // without leaving operational inventory and purchasing data stale for long.
    staleTimes: {
      dynamic: 15,
    },
    serverActions: {
      bodySizeLimit: '4352kb',
      allowedOrigins: allowedServerActionOrigins,
    },
  },
};

export default nextConfig;
