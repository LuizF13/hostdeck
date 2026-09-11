/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`;
    return [{
      source: "/(.*)",
      headers: [{
        key: "Content-Security-Policy",
        value: `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'`,
      }],
    }];
  },
};

export default nextConfig;
