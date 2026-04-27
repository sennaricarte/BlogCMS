import { Buffer } from "node:buffer";
import { processCmsImageBuffer } from "./process-cms-image";
import { seoSanitizedStorageFileName } from "./media-filename";
import { getCmsStorageBucketName, getSupabaseServiceClient } from "./supabase-service";

/**
 * Envia bytes de imagem para o bucket CMS (Supabase), com o mesmo pipeline que `/api/admin/media/upload`.
 */
export async function uploadImageBufferToCmsStorage(
  buf: Buffer,
  originalFileName: string,
): Promise<{ publicUrl: string; objectName: string }> {
  const processed = await processCmsImageBuffer(buf);
  const service = getSupabaseServiceClient();
  const bucket = getCmsStorageBucketName();
  const fromName = originalFileName.trim() || `import.${processed.ext}`;
  let objectName = seoSanitizedStorageFileName(fromName, processed.ext);

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await service.storage.from(bucket).upload(objectName, processed.buffer, {
      contentType: processed.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (!error) {
      const { data: pub } = service.storage.from(bucket).getPublicUrl(objectName);
      return { publicUrl: pub.publicUrl, objectName };
    }
    const em = (error.message || "").toLowerCase();
    const duplicate = /exists|already|duplicate|409/.test(em);
    if (!duplicate) {
      throw new Error(error.message || "Falha no Storage.");
    }
    const ext = objectName.split(".").pop() || processed.ext;
    const base = objectName.replace(/\.[^.]+$/, "");
    objectName = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  }

  throw new Error("Não foi possível criar ficheiro único no Storage.");
}
