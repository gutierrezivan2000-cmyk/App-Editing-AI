import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@vercel/sandbox",
    "@remotion/vercel",
    "@remotion/renderer",
    "@remotion/bundler",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals ?? [];
      config.externals.push(
        "@vercel/sandbox",
        "@remotion/vercel",
        "@remotion/renderer",
        "@remotion/bundler"
      );
    }
    // Remotion bundle directory no debe ser procesado por webpack
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
    };
    return config;
  },
  // Include the remotion bundle (./build) in API routes for addBundleToSandbox.
  outputFileTracingIncludes: {
    "/api/inngest": ["./build/**"],
  },
};

export default nextConfig;
