import type { NextConfig } from 'next';

// Docker images need `standalone`; local dev/`next start` must not emit the
// "next start does not work with output: standalone" warning.
const standalone = process.env.KF_STANDALONE === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: standalone ? 'standalone' : undefined,
  devIndicators: false,
  poweredByHeader: false,
  // Conversion jobs are heavy and stateful: keep them in the Node runtime.
  experimental: {
    serverActions: { bodySizeLimit: '64mb' },
    // Multi-root layouts (zh at /, en at /en) need the app-level fallback.
    globalNotFound: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "worker-src 'self' blob:",
              "connect-src 'self'",
              "font-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
