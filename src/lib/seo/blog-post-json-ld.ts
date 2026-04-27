import type { CollectionEntry } from "astro:content";
import type { ClientConfig } from "../publisher";

export type BlogSeoContext = {
  post: CollectionEntry<"blog">;
  siteBase: string;
  /** Caminho canónico, ex. `/blog/slug-do-post/` */
  canonicalPath: string;
  /** URL absoluta da imagem de destaque (og / hero) */
  heroImageAbsoluteUrl: string;
  clientConfig: ClientConfig;
  /** p.ex. "pt-BR" */
  inLanguage?: string;
};

const DEFAULT_LANG = "pt-BR";

/**
 * Gera a lista de migalhas (mesma ordem do JSON-LD BreadcrumbList).
 * Procura em `client-config` a entrada cujo `href` contém "blog" como secção; caso contrário, usa "Blog" e "/blog/".
 */
export function getBreadcrumbItems(ctx: BlogSeoContext): Array<{ name: string; href: string }> {
  const { siteBase, canonicalPath, post } = ctx;
  const base = siteBase.replace(/\/$/, "") + "/";
  const home = new URL("/", base).toString();
  const blogFromMenu = ctx.clientConfig.menuLinks.find(
    (l) => l.href === "/blog" || l.href === "/blog/" || l.href.toLowerCase().includes("/blog"),
  );
  const blogHref = (blogFromMenu?.href || "/blog/").replace(/\/$/, "") + "/";
  const blogName = blogFromMenu?.label ?? "Blog";
  const blogUrl = new URL(blogHref.replace(/^\//, ""), base).toString();
  return [
    { name: "Início", href: home },
    { name: blogName, href: blogUrl },
    { name: post.data.title, href: new URL(canonicalPath.replace(/^\//, ""), base).toString() },
  ];
}

function absoluteUrl(siteBase: string, path: string): string {
  return new URL(path.replace(/^\//, ""), siteBase.replace(/\/?$/, "/")).toString();
}

/**
 * @graph: BlogPosting (publisher=Organization do client-config) + BreadcrumbList.
 */
export function buildBlogPostJsonLdGraph(ctx: BlogSeoContext): Record<string, unknown> {
  const d = ctx.post.data;
  const inLang = ctx.inLanguage ?? DEFAULT_LANG;
  const pageUrl = absoluteUrl(ctx.siteBase, ctx.canonicalPath);
  const orgUrl = ctx.clientConfig.siteUrl?.replace(/\/$/, "")
    ? ctx.clientConfig.siteUrl.replace(/\/$/, "") + "/"
    : ctx.siteBase;
  const orgBase = orgUrl.replace(/\/?$/, "/");
  const logoPath = ctx.clientConfig.imagemCompartilhamento || "/favicon.svg";
  const logoUrl = absoluteUrl(ctx.siteBase, logoPath);

  const datePublished = d.pubDate.toISOString();
  const dateModified = (d.updatedDate ?? d.pubDate).toISOString();

  const crumbs = getBreadcrumbItems(ctx);
  const blogListUrl = crumbs[1]?.href ?? absoluteUrl(ctx.siteBase, "/blog/");

  const publisher = {
    "@type": "Organization" as const,
    "@id": `${orgBase}#organization`,
    name: ctx.clientConfig.nomeMarca,
    url: new URL("/", orgBase).toString(),
    logo: {
      "@type": "ImageObject" as const,
      url: logoUrl,
    },
  };

  const blogId = `${orgBase}#blog`;
  const webBlog = {
    "@type": "Blog" as const,
    "@id": blogId,
    name: `${ctx.clientConfig.nomeMarca} — Blog`,
    url: blogListUrl,
    publisher: { "@id": publisher["@id"] },
  };

  const blogPosting = {
    "@type": "BlogPosting" as const,
    "@id": `${pageUrl}#article`,
    headline: d.title,
    description: d.description,
    image: {
      "@type": "ImageObject" as const,
      url: ctx.heroImageAbsoluteUrl,
      width: 1200,
      height: 630,
    },
    datePublished,
    dateModified,
    inLanguage: inLang,
    author: {
      "@type": "Person" as const,
      name: d.author,
    },
    publisher: { "@id": publisher["@id"] },
    mainEntityOfPage: {
      "@type": "WebPage" as const,
      "@id": pageUrl,
    },
    isPartOf: { "@id": blogId },
  };

  const breadcrumbList = {
    "@type": "BreadcrumbList" as const,
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem" as const,
      position: i + 1,
      name: c.name,
      item: c.href,
    })),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [publisher, webBlog, blogPosting, breadcrumbList],
  };
}
