import type { AstroIntegration } from "astro";
import {
  embedClientTemplateAtProjectRoot,
  removeEmbeddedClientTemplateAtProjectRoot,
} from "../lib/publisher";

/**
 * O adapter Vercel é `unshift` na lista de integrações e corre **primeiro** em `astro:build:done`,
 * por isso o snapshot **não** pode ser gravado nesse hook depois do build.
 *
 * Em `astro:build:start`, o adapter já fez `emptyDir(.vercel/output)`; gravamos
 * `./embedded-client-template/` na raiz do projeto para o NFT (via `vite.assetsInclude`) o incluir.
 */
export function embedClientTemplateIntegration(): AstroIntegration {
  return {
    name: "embed-client-template",
    hooks: {
      "astro:build:start": async ({ logger }) => {
        await embedClientTemplateAtProjectRoot(logger);
      },
      "astro:build:done": async () => {
        await removeEmbeddedClientTemplateAtProjectRoot();
      },
    },
  };
}
