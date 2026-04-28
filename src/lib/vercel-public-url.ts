/**
 * URLs do tipo `https://nome-projeto-xxxxxhashxxxxx.vercel.app` são deploys de **preview**
 * (ou antigos); quando o deploy some, a Vercel responde DEPLOYMENT_NOT_FOUND.
 * A URL de **produção** estável é `https://<vercelProjectName>.vercel.app` (slug do projecto).
 */
export function preferStableVercelProductionUrl(raw: string, vercelProjectName: string): string {
  const slug = vercelProjectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug || !raw.trim()) return raw.trim();
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return raw.trim();
    const host = u.hostname.toLowerCase();
    if (!host.endsWith(".vercel.app")) return raw.trim();
    const withoutTld = host.slice(0, -".vercel.app".length);
    const canonical = `https://${slug}.vercel.app/`;
    if (withoutTld === slug) return canonical;
    const prefix = `${slug}-`;
    if (withoutTld.startsWith(prefix) && withoutTld.length > prefix.length) {
      const extra = withoutTld.slice(prefix.length);
      if (/^[a-z0-9]{4,24}$/i.test(extra)) {
        return canonical;
      }
    }
    // Para hosts *.vercel.app diferentes do nome do projeto, força URL canónica estável.
    return canonical;
  } catch {
    return raw.trim();
  }
}
