import sharp from "sharp";
import { detectImageKindFromBuffer } from "./validate-hero-image";

const MAX_WIDTH = 1920;
const WEBP_QUALITY = 80;

export type ProcessedCmsImage = {
  buffer: Buffer;
  contentType: string;
  /** extensão final (sem ponto) */
  ext: string;
};

/**
 * JPG/PNG → WebP (q80), largura máx. 1920px.
 * WebP/GIF → reencodificar em WebP com as mesmas regras (GIF animado vira estático).
 * SVG → sem alteração (vetor).
 */
export async function processCmsImageBuffer(buf: Buffer): Promise<ProcessedCmsImage> {
  const kind = detectImageKindFromBuffer(buf);
  if (!kind) {
    throw new Error("Formato de imagem não suportado.");
  }
  if (kind.ext === "svg") {
    return { buffer: buf, contentType: "image/svg+xml", ext: "svg" };
  }

  const meta = await sharp(buf, { failOn: "none" }).metadata();
  let pipeline = sharp(buf, { failOn: "none" }).rotate();
  if (meta.width && meta.width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }
  const out = await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
  return { buffer: out, contentType: "image/webp", ext: "webp" };
}
