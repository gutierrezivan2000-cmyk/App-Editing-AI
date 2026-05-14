import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@vercel/sandbox",
    "@remotion/vercel",
    "@remotion/renderer",
    "@remotion/bundler",
    "ffmpeg-static",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals ?? [];
      config.externals.push(
        "@vercel/sandbox",
        "@remotion/vercel",
        "@remotion/renderer",
        "@remotion/bundler",
        "ffmpeg-static"
      );
    }
    // Remotion bundle directory no debe ser procesado por webpack
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
    };
    return config;
  },
  // Incluye en el lambda de /api/inngest:
  // - bundle de Remotion (./build) para addBundleToSandbox
  // - binario de ffmpeg-static (lo usa el módulo de montaje)
  outputFileTracingIncludes: {
    "/api/inngest": [
      "./build/**",
      "./node_modules/ffmpeg-static/**",
    ],
  },
};

export default nextConfig;
