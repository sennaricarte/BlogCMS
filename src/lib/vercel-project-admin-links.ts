import type { ClientProject } from "./projects-data";
import { preferStableVercelProductionUrl } from "./vercel-public-url";

export function projectPublicSiteUrl(p: ClientProject): string {
  const raw = (p.vercelUrl || p.siteUrl).trim() || p.siteUrl;
  const name = p.vercelProjectName?.trim() || "project";
  return preferStableVercelProductionUrl(raw, name);
}

export function projectVercelDeploymentsUrl(p: ClientProject): string {
  if (p.vercelLogsUrl?.trim()) {
    return p.vercelLogsUrl.trim();
  }
  const scope = p.vercelScope?.trim();
  const name = p.vercelProjectName?.trim();
  if (scope && name) {
    return `https://vercel.com/${encodeURIComponent(scope)}/${encodeURIComponent(name)}/deployments`;
  }
  return "https://vercel.com/dashboard";
}

export function projectVercelSpeedInsightsUrl(p: ClientProject): string {
  if (p.vercelSpeedInsightsUrl?.trim()) {
    return p.vercelSpeedInsightsUrl.trim();
  }
  const scope = p.vercelScope?.trim();
  const name = p.vercelProjectName?.trim();
  if (scope && name) {
    return `https://vercel.com/${encodeURIComponent(scope)}/${encodeURIComponent(name)}/speed-insights`;
  }
  return "https://vercel.com/dashboard";
}
