/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A deterministic per-deploy ID instead of the random one Next.js
  // generates by default - the client polls for THIS changing to notice a
  // new deployment is live (see lib/version.js), which only works if a
  // fresh build actually gets a different ID from the one currently
  // running. Vercel sets VERCEL_GIT_COMMIT_SHA on every build; falls back
  // to a timestamp for local dev, where every build is "new" anyway.
  generateBuildId: async () => process.env.VERCEL_GIT_COMMIT_SHA || `dev-${Date.now()}`,
};

module.exports = nextConfig;
