import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({
  path: resolve(process.cwd(), "../../.env.local")
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@signalstack/contracts",
    "@signalstack/config",
    "@signalstack/ui",
    "@signalstack/map-core",
    "@signalstack/policy"
  ],
  typedRoutes: true,
  env: {
    GATEWAY_API_URL: process.env.GATEWAY_API_URL,
    NEXT_PUBLIC_GATEWAY_API_URL: process.env.NEXT_PUBLIC_GATEWAY_API_URL
  }
};

export default nextConfig;
