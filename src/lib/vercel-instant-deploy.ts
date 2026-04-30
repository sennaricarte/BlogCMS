/** Link «Deploy instantâneo» da Vercel (importa o repositório GitHub). */
export function vercelNewCloneUrl(repositoryHttpsUrl: string): string {
  const u = (repositoryHttpsUrl || "").trim();
  if (!u) return "https://vercel.com/new";
  return `https://vercel.com/new/clone?repository-url=${encodeURIComponent(u)}`;
}
