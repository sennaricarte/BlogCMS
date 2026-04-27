/**
 * Constrói JSON-LD com @graph: WebPage + FAQPage (quando há perguntas).
 * FAQPage segue https://schema.org/FAQPage para rich results no Google.
 */
export function buildPageJsonLdGraph(opts: {
  pageUrl: string;
  title: string;
  description: string;
  pubDateIso: string;
  faqItems: Array<{ question: string; answer: string }>;
}): Record<string, unknown> {
  const { pageUrl, title, description, pubDateIso, faqItems } = opts;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      name: title,
      description,
      url: pageUrl,
      datePublished: pubDateIso,
    },
  ];
  if (faqItems.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
