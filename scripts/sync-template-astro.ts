/**
 * Gera `./template-astro/` na raiz do BlogCMS: cópia filtrada do código-fonte Astro
 * que será enviada aos repositórios dos clientes (sem build; a Vercel faz o build).
 *
 * Chamado por `npm run sync:template` e automaticamente em `prebuild` antes de `astro build`.
 */
import { syncTemplateAstroToProjectRoot } from "../src/lib/publisher";

await syncTemplateAstroToProjectRoot();
console.log("[sync-template-astro] Concluído: ./template-astro/");
