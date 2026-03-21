import type { NextConfig } from "next";

const shouldExportStatic = process.env.NEXT_OUTPUT_EXPORT === "1";

const nextConfig: NextConfig = {
  output: shouldExportStatic ? "export" : undefined,
  trailingSlash: true,
  outputFileTracingRoot: process.cwd(),
  images: {
    unoptimized: true
  }
};

export default nextConfig;
