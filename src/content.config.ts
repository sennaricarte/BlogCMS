import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { pageBlockZod } from "./lib/page-blocks.zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** Título para SERP; se vazio, o site usa o título do artigo. */
      seoTitle: z.string().max(100).optional(),
      description: z.string().max(160),
      /** Palavra-chave de foco (editor / relatórios). */
      seoFocusKeyword: z.string().max(200).optional(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      author: z.string(),
      /** Asset local (coleção) ou URL absoluta (ex.: hero no Supabase após importação). */
      heroImage: z.union([image(), z.string().url()]),
      tags: z.array(z.string()).default([]),
      category: z.string().optional(),
      draft: z.boolean().default(false),
      /** `true` se o post foi agendado (data de publicação futura); a API /api/admin/publish-scheduled trata a estreia. */
      scheduled: z.boolean().optional(),
    }),
});

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    /** Blocos de página (sistema de layout por componentes) */
    pageBlocks: z.array(pageBlockZod).optional().default([]),
  }),
});

export const collections = { blog, pages };
