/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@signalstack/contracts",
    "@signalstack/config",
    "@signalstack/ui",
    "@signalstack/map-core",
    "@signalstack/policy"
  ],
  typedRoutes: true
};

export default nextConfig;
