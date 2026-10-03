import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Private tool: nothing here may be indexed, whatever a page's metadata says.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  experimental: {
    // This repo lives on an exFAT volume, where macOS writes `._*` sidecars
    // beside every cache file and breaks Turbopack's on-disk dev cache.
    // Off = slower cold starts only. Safe to remove on APFS/ext4.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
