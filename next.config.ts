import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/Node-only packages out of the server bundle. ssh2 ships a
  // native `.node` crypto binding (built when a toolchain is present) that
  // Turbopack cannot place into an ESM chunk ("non-ecmascript placeable
  // asset"); pg/undici are also happier required at runtime. Next loads these
  // via Node's require from node_modules instead of bundling them.
  serverExternalPackages: ["ssh2", "node-ssh", "cpu-features", "pg"],

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
