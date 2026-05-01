import { z } from "astro/zod";

const linkButtonZod = z.object({
  label: z.string(),
  url: z.string(),
});

const heroButtonZod = z.object({
  label: z.string(),
  url: z.string(),
});

const faqItemZod = z.object({
  question: z.string(),
  answer: z.string(),
});

/** Blocos de página: montados no CMS e guardados em `pageBlocks` (frontmatter). */
export const pageBlockZod = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("hero"),
    /**
     * classic — título + subtítulo (legado).
     * splitImageLeft — imagem à esquerda, texto e CTAs à direita.
     * splitImageRight — texto e CTAs à esquerda, imagem à direita.
     * centered — tagline, título, texto e CTAs centrados.
     */
    layout: z.enum(["classic", "splitImageLeft", "splitImageRight", "centered"]).optional(),
    tagline: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    subtitle: z.string().optional(),
    imageSrc: z.string().optional(),
    imageAlt: z.string().optional(),
    primaryButton: heroButtonZod.optional(),
    secondaryButton: heroButtonZod.optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("contactForm"),
    title: z.string().optional(),
    nameLabel: z.string(),
    emailLabel: z.string(),
    subjectLabel: z.string(),
    messageLabel: z.string(),
    submitLabel: z.string(),
    contactEmail: z.string().optional(),
    privacyNote: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("linksList"),
    title: z.string().optional(),
    links: z.array(linkButtonZod),
  }),
  z.object({
    id: z.string(),
    type: z.literal("faq"),
    title: z.string().optional(),
    /** Texto de destaque (ex.: horário de funcionamento), mostrado acima das perguntas. */
    horarioFuncionamento: z.string().optional(),
    items: z.array(faqItemZod),
  }),
  z.object({
    id: z.string(),
    type: z.literal("qrCode"),
    /** Vazio = usar URL canónica da página no site */
    targetUrl: z.string(),
    caption: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("mapLocation"),
    title: z.string().optional(),
    /** Texto mostrado e usado no embed se não houver coordenadas */
    address: z.string(),
    /** Rótulo do botão (ex.: Como chegar) */
    directionsLabel: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("cta"),
    title: z.string(),
    text: z.string().optional(),
    primaryLabel: z.string(),
    primaryUrl: z.string(),
    secondaryLabel: z.string().optional(),
    secondaryUrl: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("image"),
    src: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("quote"),
    text: z.string(),
    author: z.string().optional(),
    authorRole: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("separator"),
    style: z.enum(["line", "dots", "space"]).optional(),
    /** Nome acessível da secção (separador decorativo se vazio) */
    label: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("videoEmbed"),
    /** Título do iframe (obrigatório para acessibilidade) */
    title: z.string(),
    provider: z.enum(["youtube", "vimeo"]),
    /** ID (YouTube) ou numérico (Vimeo) */
    videoId: z.string(),
  }),
]);

export type PageBlock = z.infer<typeof pageBlockZod>;
