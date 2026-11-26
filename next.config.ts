import type { NextConfig } from "next";

const signInCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob: https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com https://*.supabase.co",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const privatePageCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const isHttpsOrigin = (process.env.APP_ORIGIN ?? "").startsWith("https://");

const publicPageCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const commonSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(isHttpsOrigin
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const discoverFilterParams = [
  "q",
  "type",
  "mode",
  "price",
  "source",
  "city",
  "distance",
  "sort",
  "cursor",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: commonSecurityHeaders,
      },
      {
        source: "/discover",
        headers: [
          {
            key: "Content-Security-Policy",
            value: publicPageCsp,
          },
        ],
      },
      {
        source: "/events/:id",
        headers: [
          {
            key: "Content-Security-Policy",
            value: publicPageCsp,
          },
        ],
      },
      {
        source: "/privacy",
        headers: [
          {
            key: "Content-Security-Policy",
            value: publicPageCsp,
          },
        ],
      },
      ...discoverFilterParams.map((param) => ({
        source: "/discover",
        has: [{ type: "query" as const, key: param }],
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, follow",
          },
        ],
      })),
      {
        source: "/sign-in",
        headers: [
          {
            key: "Content-Security-Policy",
            value: signInCsp,
          },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
          {
            key: "Cache-Control",
            value: "private, no-store",
          },
        ],
      },
      {
        source: "/(my-events|settings|admin/:path*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: privatePageCsp,
          },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
          {
            key: "Cache-Control",
            value: "private, no-store",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
