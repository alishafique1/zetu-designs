import type { NextConfig } from 'next';

// Daemon port the local Express server binds to (see daemon/cli.js). The
// dev-all launcher overrides OD_PORT after probing for a free port; we read
// the same env so /api, /artifacts, and /frames always reach the right
// daemon instance during `next dev`.
const DAEMON_PORT = Number(process.env.OD_PORT) || 7456;
const DAEMON_ORIGIN = `http://127.0.0.1:${DAEMON_PORT}`;

const isProd = process.env.NODE_ENV !== 'development';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Clerk requires server-side rendering — switch from static 'export' to
  // 'standalone' output so middleware and server actions work in production.
  ...(isProd
    ? {
        images: { unoptimized: true },
        output: 'standalone',
      }
    : {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: `${DAEMON_ORIGIN}/api/:path*` },
            { source: '/artifacts/:path*', destination: `${DAEMON_ORIGIN}/artifacts/:path*` },
            { source: '/frames/:path*', destination: `${DAEMON_ORIGIN}/frames/:path*` },
          ];
        },
      }),
};

export default nextConfig;
