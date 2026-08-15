/** @type {import('next').NextConfig} */
const nextConfig = {
  // The pipeline reads snapshots from the filesystem at request time, so pages
  // must stay dynamic rather than being prerendered at build.
  outputFileTracingIncludes: {
    "/**": ["./data/**", "./config/**"],
  },
};

export default nextConfig;
