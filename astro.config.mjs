// @ts-check
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { rehypeLazyMarkdownImages } from './src/rehype/lazy-markdown-images.mjs';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Defina `site` (ou `SITE` no build) para URLs canônicas e Open Graph absolutas em produção.
export default defineConfig({
  integrations: [react()],
  // site: 'https://seu-dominio.com',
  /**
   * Astro 6+ não usa `output: 'hybrid'`: o padrão `static` + adapter gera o site em grande parte
   * estático; páginas/API com `export const prerender = false` passam a ser servidas no servidor
   * (Admin e `/api/*`). Em produção na Vercel usa-se `@astrojs/vercel` (serverless).
   */
  adapter: vercel(),
  markdown: {
    rehypePlugins: [rehypeLazyMarkdownImages],
  },
  vite: {
    /**
     * Código-fonte do template Astro (gerado por `npm run sync:template` / `prebuild`) para o publisher na Vercel.
     */
    assetsInclude: ['template-astro/**/*'],
    plugins: [tailwindcss()],
    /**
     * Uma única cópia de React evita "jsxDEV is not a function" (runtime JSX incoerente).
     */
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    /**
     * Pré-empacota dependências usadas em ilhas React (TipTap, Turndown, Supabase) para evitar
     * 504 "Outdated Optimize Dep" e falhas a hidratar (Failed to fetch dynamically imported module).
     * Inclui explicitamente o runtime JSX para o dev server não servir metade de um pack antigo.
     */
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        '@supabase/ssr',
        'turndown',
        'turndown-plugin-gfm',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/extension-text-style',
        '@tiptap/core',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-table',
        '@tiptap/extension-table-row',
        '@tiptap/extension-table-header',
        '@tiptap/extension-table-cell',
        '@tiptap/extension-underline',
        '@tiptap/extension-youtube',
      ],
    },
  },
});