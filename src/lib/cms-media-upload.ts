export function fileToBase64Content(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      if (typeof s !== "string") {
        reject(new Error("Falha ao ler ficheiro."));
        return;
      }
      const i = s.indexOf("base64,");
      resolve(i === -1 ? s : s.slice(i + 7));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export type CmsMediaUploadSuccess = {
  /** URL pública (Storage) para o editor e pré-visualização */
  previewUrl: string;
  fileName: string;
  /** URL pública para uso em `![alt](url)` */
  relativeMarkdown: string;
};

/**
 * Envia imagem para o Supabase Storage (Sharp no servidor: WebP, max. 1920px, qualidade 80).
 */
export async function uploadCmsMediaFile(
  file: File,
): Promise<{ ok: true; data: CmsMediaUploadSuccess } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Só se aceitam ficheiros de imagem." };
  }
  try {
    const b64 = await fileToBase64Content(file);
    const res = await fetch("/api/admin/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        contentBase64: b64,
        originalFileName: file.name,
      }),
    });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      fileName?: string;
      publicUrl?: string;
      relativeMarkdown?: string;
    };
    if (!res.ok || !j.ok || !j.fileName || !j.publicUrl) {
      return { ok: false, error: j.error || "Falha no envio para o Storage." };
    }
    return {
      ok: true,
      data: {
        previewUrl: j.publicUrl,
        fileName: j.fileName,
        relativeMarkdown: j.relativeMarkdown || j.publicUrl,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro inesperado no envio." };
  }
}
