/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN ?? "http://localhost:4000";

// When BUILD_EXPORT=1 we emit a fully static site (web/out) that the Node
// backend serves directly — one process, no Next runtime (ideal for the phone).
// Otherwise we run the normal dev server with an /api proxy to the backend.
const EXPORT = process.env.BUILD_EXPORT === "1";

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
