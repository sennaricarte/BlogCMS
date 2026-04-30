/** Limite alinhado com uso razoável de hero/OG; GitHub suporta ficheiros maiores, mas o CMS fica com limite rígido. */
export const MAX_HERO_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Reconhece o tipo a partir de bytes mínimos (e SVG como texto no início).
 * Devolve extensão de ficheiro (sem ponto) para `src/assets/blog/...`.
 */
export function detectImageKindFromBuffer(buf: Buffer): { ext: string } | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: "png" };
  if (buf.length >= 6) {
    const h = buf.toString("ascii", 0, 6);
    if (h === "GIF87a" || h === "GIF89a") return { ext: "gif" };
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return { ext: "webp" };
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return { ext: "avif" };
  }
  const head = buf.slice(0, Math.min(512, buf.length)).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || /^<svg[\s>]/i.test(head)) return { ext: "svg" };
  return null;
}
