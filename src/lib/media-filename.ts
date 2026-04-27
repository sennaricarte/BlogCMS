const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico)$/i;

/** Nome de ficheiro (não path) de imagem aceite para a pasta de media do repositório. */
export function isImageFileName(name: string): boolean {
  return IMAGE_EXT.test(name) && !name.startsWith(".");
}

/**
 * Normaliza o nome do ficheiro para URLs seguras: sem acentos, sem espaços,
 * só [a-z0-9-], preserva a extensão.
 */
export function sanitizeMediaFileBase(name: string): string {
  const m = name.trim().match(/^(.*?)(\.[^.]+)?$/);
  const rawBase = (m?.[1] || "imagem").trim() || "imagem";
  const ext = (m?.[2] || "").toLowerCase();
  const nfd = rawBase.normalize("NFD").replace(/\p{M}/gu, "");
  const slug = nfd
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const base = slug || "imagem";
  return ext ? `${base}${ext}` : base;
}

/**
 * Nome final no Storage: só [a-z0-9-] e extensão (ex.: .webp, .svg).
 * Usa o nome original só para a raiz, sem o path.
 */
export function seoSanitizedStorageFileName(originalFileName: string, outExt: string): string {
  const tail = (originalFileName || "").split(/[\\/]/).pop() || "imagem";
  const noExt = tail.replace(/\.[^.]+$/, "");
  return sanitizeMediaFileBase(`${noExt}.${outExt.replace(/^\./, "")}`);
}
