/** Chave única no `localStorage` do browser (integração admin). */
export const ADMIN_INTEGRATION_STORAGE_KEY = "blogcms-admin-integration" as const;

/** Dados guardados localmente até existir backend. */
export type AdminIntegrationPayload = {
  GITHUB_PERSONAL_TOKEN: string;
  VERCEL_TOKEN: string;
  VERCEL_TEAM_ID?: string;
};
