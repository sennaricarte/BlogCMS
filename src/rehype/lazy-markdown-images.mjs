import { visit } from "unist-util-visit";

/**
 * Garante que imagens geradas a partir de Markdown (corpo do post) não
 * disputem a prioridade de rede com a hero/ LCP: lazy + prioridade baixa.
 */
export function rehypeLazyMarkdownImages() {
  /**
   * @param {import('hast').Root} tree
   */
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "img") return;
      const p = node.properties || (node.properties = {});
      if (p.loading == null) p.loading = "lazy";
      if (p.decoding == null) p.decoding = "async";
      if (p.fetchPriority == null && p.fetchpriority == null) {
        p.fetchPriority = "low";
      }
    });
  };
}
