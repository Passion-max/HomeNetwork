/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN ?? "http://localhost:4000";

// Any production build emits a fully static site (no Next server runtime): the
// home backend serves web/out directly, and Vercel serves it from its CDN (the
// hosted UI talks to Supabase straight from the browser, so it needs no server).
// Only `next dev` uses the /api proxy + allowedDevOrigins.
const EXPORT = process.env.BUILD_EXPORT === "1" || process.env.NODE_ENV === "production";

const nextConfig = EXPORT
  ? {
      output: "export",
      images: { unoptimized: true },
    }
  : {
      allowedDevOrigins: ["192.168.1.2", "localhost"],
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
      },
    };

export default nextConfig;
