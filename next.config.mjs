/** @type {import('next').NextConfig} */

// GitHub Pages serves a project repo (as opposed to a <user>.github.io repo)
// from a /<repo-name> subpath, so every route and asset needs that prefix
// baked in at build time. Set only by the deploy workflow — local dev and
// `npm run build` for self-hosting stay at the root.
const isGithubPages = process.env.GITHUB_PAGES === "true";
const repoName = "Stockr";

const nextConfig = {
  // Static export: every page is rendered once at build time from whatever
  // is in data/latest.json then, and the result is plain HTML/JS/CSS with no
  // server behind it. That's what GitHub Pages can serve. It means the
  // dashboard only updates when the site is rebuilt — the daily-refresh
  // workflow does exactly that (refresh data, rebuild, redeploy).
  output: "export",
  basePath: isGithubPages ? `/${repoName}` : "",
  assetPrefix: isGithubPages ? `/${repoName}/` : undefined,
  trailingSlash: true,
};

export default nextConfig;
