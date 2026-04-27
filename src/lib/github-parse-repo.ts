/**
 * Nome `owner/repo` do GitHub, sem lógica de rede (útil no browser e no servidor).
 */
export function parseOwnerRepo(
  fullName: string,
): { owner: string; repo: string } {
  const s = fullName.trim();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(s)) {
    throw new Error('O repositório deve estar no formato "dono/repositório".');
  }
  const [owner, ...rest] = s.split("/");
  const repo = rest.join("/");
  return { owner, repo };
}
