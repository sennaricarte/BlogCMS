/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  /**
   * Fallback quando `localStorage` do alvo CMS ainda não tem repo (ex.: 1.º paint).
   * Formato: `proprietario/repositório`. Combinar com {@link PUBLIC_GITHUB_BRANCH}.
   */
  readonly PUBLIC_GITHUB_REPO_FULL_NAME?: string;
  /** Ramo no GitHub para URLs raw de pré-visualização (predefinido: main). */
  readonly PUBLIC_GITHUB_BRANCH?: string;
  /** Só no servidor. Necessário para uploads na Central de Mídia (Storage). */
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Bucket do Storage (predefinido: cms-media). */
  readonly SUPABASE_STORAGE_BUCKET?: string;
  /** Segredo para `/api/admin/publish-scheduled` (Bearer ou ?secret=). */
  readonly SCHEDULED_PUBLISH_SECRET?: string;
  /** PAT do GitHub (servidor) para publicar posts agendados nos repositórios de `projects.json`. */
  readonly SCHEDULED_PUBLISH_GITHUB_TOKEN?: string;
  /** Ramo Git (predefinido: main). */
  readonly SCHEDULED_PUBLISH_GITHUB_BRANCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
