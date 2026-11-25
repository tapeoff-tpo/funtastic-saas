import type { NextConfig } from "next";

const allowedServerActionOrigins = process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // The quality-PDF renderer loads platform-specific native code and its own
  // module-relative fake worker at runtime. Keeping both packages external
  // preserves the worker's `import.meta.url` resolution in the Vercel function.
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/operations/coupang-registration/extension': ['./tools/browser-extensions/funtastic-coupang-registration/**/*'],
    '/api/operations/coupang-registration/quality-label': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
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
