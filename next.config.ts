import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. An orphaned package-lock.json in the home directory
  // makes Turbopack infer the wrong root and warn on every build.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
