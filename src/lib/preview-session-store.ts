import type { PageBlock } from "./page-blocks.zod";

type Entry = {
  blocks: PageBlock[];
  pageUrl: string;
  at: number;
};

/** Memória partilhada do processo Node (válida para o adapter Node/VM único). Em ambientes serverless com várias instâncias, convém substituir por cache partilhado. */
const store = new Map<string, Entry>();
const TTL_MS = 8 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
}

/**
 * Grava o payload de pré-visualização (memória de processo, só para o iframe admin).
 * Expira após 8 minutos.
 */
export function putPreviewBlockSession(data: { blocks: PageBlock[]; pageUrl: string }): string {
  prune();
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `pv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  store.set(id, { blocks: data.blocks, pageUrl: data.pageUrl, at: Date.now() });
  return id;
}

export function getPreviewBlockSession(id: string): { blocks: PageBlock[]; pageUrl: string } | null {
  prune();
  const v = store.get(id);
  if (!v) return null;
  if (Date.now() - v.at > TTL_MS) {
    store.delete(id);
    return null;
  }
  return { blocks: v.blocks, pageUrl: v.pageUrl };
}
