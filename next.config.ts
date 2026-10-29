import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Keeps Turbopack from picking up a lockfile in a parent folder.
  turbopack: { root: process.cwd() },
  async redirects() {
    return [{ source: "/", destination: "/tonight", permanent: false }];
  },
};

export default nextConfig;
