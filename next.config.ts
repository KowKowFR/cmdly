import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // Content-Security-Policy.
            // NOTE on `script-src 'unsafe-inline'`: Next.js (App Router / React 19
            // RSC) streams the hydration flight payload through inline
            // `<script>self.__next_f.push(...)</script>` tags. Without an explicit
            // script-src the directive falls back to `default-src 'self'`, which
            // forbids inline scripts — those flight chunks never execute, the RSC
            // stream never completes ("Connection closed"), hydration fails and the
            // page renders blank. Allowing inline scripts unblocks hydration.
            // Hardening path: switch to a per-request nonce injected in
            // src/proxy.ts and drop 'unsafe-inline'.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self'",
              "font-src 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
