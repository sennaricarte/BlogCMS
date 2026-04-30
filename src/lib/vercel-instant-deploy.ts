/** Link de importação direta da Vercel para um repositório GitHub existente. */
export function vercelNewImportUrl(repositoryHttpsUrl: string): string {
  const u = (repositoryHttpsUrl || "").trim();
  if (!u) return "https://vercel.com/new";
  return `https://vercel.com/new/import?s=${encodeURIComponent(u)}`;
}
