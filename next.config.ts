import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@vercel/sandbox"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals ?? [];
      config.externals.push("@vercel/sandbox");
    }
    return config;
  },
};

export default nextConfig;
