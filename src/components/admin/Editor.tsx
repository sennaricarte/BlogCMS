import { Color, TextStyle } from "@tiptap/extension-text-style";
import Link from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import { Youtube } from "@tiptap/extension-youtube";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadCmsMediaFile } from "../../lib/cms-media-upload";
import {
  readEditorGithubPatForImagePreview,
  readEditorImagePreviewContext,
  rewriteHtmlImagesForAdminEditor,
  type EditorImagePreviewContext,
} from "../../lib/admin-editor-image-urls";
import { cleanPastedHtml } from "../../lib/docs-paste";
import { htmlToMarkdown } from "../../lib/html-to-markdown";
import { markdownToHtmlForEditor } from "../../lib/markdown-to-html";
import { createEditorImagePreviewExtension } from "./tiptap-editor-image";
import { fixNextImageWithoutAlt, promptAltRequired } from "./image-alt-utils";
import { MediaGalleryModal } from "./MediaGalleryModal";
import { MenuBar } from "./MenuBar";
import { Vimeo } from "./tiptap-vimeo";
import "./editor.css";

export type EditorProps = {
  /** Corpo do artigo em Markdown (ficheiro .md) — vazio dá parágrafo vazio. */
  initialMarkdown?: string;
  /** A cada alteração, HTML do Tiptap → Markdown (Turndown) para guardar no GitHub. */
  onChange: (markdown: string) => void;
  /**
   * Atraso antes de Turndown (ms). `0` = imediato (ex. sincronizar campo oculto no editar post).
   * @default 120
   */
  markdownDebounceMs?: number;
  /**
   * Sobrepõe repo/ramo para URLs raw de pré-visualização. Por omissão: localStorage (`blogcms-cms-target`)
   * ou `PUBLIC_GITHUB_REPO_FULL_NAME` / `PUBLIC_GITHUB_BRANCH`.
   */
  imagePreviewContext?: EditorImagePreviewContext | null;
};

const EMPTY_MD = "";
const DEFAULT_MD_DEBOUNCE = 120;

function resolveImagePreviewContext(
  prop: EditorImagePreviewContext | null | undefined,
): EditorImagePreviewContext | null | undefined {
  if (prop !== undefined) return prop;
  return readEditorImagePreviewContext();
}

function buildTiptapContent(
  initialMarkdown: string | undefined,
  preview: EditorImagePreviewContext | null | undefined,
): string {
  return markdownToHtmlForEditor(initialMarkdown ?? EMPTY_MD, preview ?? undefined);
}

/** Ponte lida em cada render: {@link getDisplayUrl} usa contexto + token atualizados. */
type PreviewBridge = { context: EditorImagePreviewContext | null; token: string | null };

/**
 * TipTap com `immediatelyRender: false` e `getServerSnapshot` do `useEditor` suporta SSR/hidratação
 * no Astro (`client:load`) sem aceder a `document` no 1.º passo. Não utilizar `useEffect` extra para
 * “só no cliente”: dessincronizava a hidratação e deixava o texto “A carregar editor…” para sempre.
 */
export function Editor({
  initialMarkdown = "",
  onChange,
  markdownDebounceMs = DEFAULT_MD_DEBOUNCE,
  imagePreviewContext,
}: EditorProps) {
  const previewBridgeRef = useRef<PreviewBridge>({ context: null, token: null });
  previewBridgeRef.current.context =
    resolveImagePreviewContext(imagePreviewContext) ?? readEditorImagePreviewContext();
  previewBridgeRef.current.token = readEditorGithubPatForImagePreview();

  const imagePreviewExtension = useMemo(
    () =>
      createEditorImagePreviewExtension({
        getPreviewContext: () => previewBridgeRef.current.context,
        getGithubToken: () => previewBridgeRef.current.token,
      }),
    [],
  );

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [mediaUploadBusy, setMediaUploadBusy] = useState(false);
  const mediaUploadBusyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<import("@tiptap/core").Editor | null>(null);
  const altDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mdDelayRef = useRef(markdownDebounceMs);
  mdDelayRef.current = markdownDebounceMs;

  const handleMarkdownOut = useCallback(
    (ed: import("@tiptap/core").Editor) => {
      if (mdDebounceRef.current) {
        clearTimeout(mdDebounceRef.current);
      }
      const run = () => onChange(htmlToMarkdown(ed.getHTML()));
      const d = mdDelayRef.current;
      if (d <= 0) {
        run();
        return;
      }
      mdDebounceRef.current = setTimeout(() => {
        mdDebounceRef.current = null;
        run();
      }, d);
    },
    [onChange],
  );

  const initialContentRef = useRef<string | null>(null);
  if (initialContentRef.current === null) {
    initialContentRef.current = buildTiptapContent(initialMarkdown, resolveImagePreviewContext(imagePreviewContext));
  }

  /**
   * Referências estáveis são obrigatórias: novos objectos `extensions` / `editorProps` a cada render
   * fazem o TipTap destruir/recriar o `useEditor` em loop e o `editor` fica `null` — ecrã eterno
   * em “A preparar a área de edição…”. @see https://tiptap.dev/docs/guides/performance
   */
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      TextStyle,
      Color,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      }),
      imagePreviewExtension,
      Table.configure({
        resizable: false,
        lastColumnResizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Youtube.configure({
        width: 640,
        height: 360,
        HTMLAttributes: {
          class: "max-w-full rounded-sm",
        },
      }),
      Vimeo.configure({
        width: 640,
        height: 360,
        HTMLAttributes: {
          class: "max-w-full rounded-sm",
        },
      }),
    ],
    [imagePreviewExtension],
  );

  const onUpdate = useCallback(
    ({ editor: ed }: { editor: import("@tiptap/core").Editor }) => {
      handleMarkdownOut(ed);
      if (altDebounceRef.current) {
        clearTimeout(altDebounceRef.current);
      }
      altDebounceRef.current = setTimeout(() => {
        altDebounceRef.current = null;
        fixNextImageWithoutAlt(ed);
      }, 100);
    },
    [handleMarkdownOut],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: "tiptap ProseMirror-wp focus:ring-0",
        "aria-label": "Corpo do artigo",
        spellCheck: "true" as const,
      },
      transformPastedHTML: (html: string) => {
        const cleaned = cleanPastedHtml(html);
        return rewriteHtmlImagesForAdminEditor(
          cleaned,
          resolveImagePreviewContext(imagePreviewContext) ?? undefined,
        );
      },
      handlePaste: (_view: unknown, event: ClipboardEvent) => {
        const ed = editorRef.current;
        if (!ed) return false;
        const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        const file = files[0];
        if (mediaUploadBusyRef.current) {
          return true;
        }
        const alt = promptAltRequired("Texto alternativo (obrigatório) — imagem colada do clipboard:");
        if (alt === null) return true;
        mediaUploadBusyRef.current = true;
        setMediaUploadBusy(true);
        void uploadCmsMediaFile(file)
          .then((r) => {
            mediaUploadBusyRef.current = false;
            setMediaUploadBusy(false);
            if (!r.ok) {
              window.alert(r.error);
              return;
            }
            const ed2 = editorRef.current;
            if (!ed2 || ed2.isDestroyed) return;
            ed2.chain().focus().setImage({ src: r.data.previewUrl, alt }).run();
          })
          .catch((e) => {
            mediaUploadBusyRef.current = false;
            setMediaUploadBusy(false);
            window.alert(e instanceof Error ? e.message : "Falha ao enviar a imagem.");
          });
        return true;
      },
    }),
    [],
  );

  /**
   * Dependências vazias + `content` só no 1.º render desta montagem: o pai passa
   * `initialMarkdown={contentMd}` e o `contentMd` muda a cada tecla — isso não pode
   * alimentar `content` em opções novas (setOptions) nem alterar as deps do hook, senão
   * o TipTap rebenta o documento ou o `editor` fica preso em `null`. Remontar o
   * componente com `key` (rascunho / body do GitHub) define um HTML inicial novo.
   */
  const editor = useEditor(
    {
      extensions,
      content: initialContentRef.current ?? "<p></p>",
      immediatelyRender: false,
      editorProps,
      onUpdate,
    },
    [],
  );

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  useEffect(
    () => () => {
      if (altDebounceRef.current) {
        clearTimeout(altDebounceRef.current);
      }
      if (mdDebounceRef.current) {
        clearTimeout(mdDebounceRef.current);
      }
    },
    [],
  );

  if (!editor) {
    return (
      <div
        className="min-h-80 rounded-lg border border-slate-200/90 bg-slate-50/80 p-4 text-sm text-slate-500"
        role="status"
        aria-live="polite"
      >
        Preparando a área de edição…
      </div>
    );
  }

  return (
    <>
      <div className="editor-wp-style overflow-hidden rounded-md border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Carregar arquivo de imagem"
          disabled={mediaUploadBusy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file || !file.type.startsWith("image/")) return;
            if (mediaUploadBusyRef.current) {
              return;
            }
            const alt = promptAltRequired("Texto alternativo (obrigatório) — imagem carregada do disco:");
            if (alt === null) return;
            mediaUploadBusyRef.current = true;
            setMediaUploadBusy(true);
            const r = await uploadCmsMediaFile(file);
            mediaUploadBusyRef.current = false;
            setMediaUploadBusy(false);
            if (!r.ok) {
              window.alert(r.error);
              return;
            }
            editor.chain().focus().setImage({ src: r.data.previewUrl, alt }).run();
          }}
        />
        <div className="sticky top-0 z-20 bg-slate-50/95 shadow-[0_1px_0_0_rgba(15,23,42,0.06)]">
          <MenuBar
            editor={editor}
            fileInputRef={fileInputRef}
            onMediaGallery={() => setGalleryOpen(true)}
            imageUploadDisabled={mediaUploadBusy}
          />
        </div>
        <p
          className="border-b border-slate-100/90 bg-amber-50/40 px-3 py-1.5 text-xs text-amber-950/90"
          role={mediaUploadBusy ? "status" : undefined}
          aria-live={mediaUploadBusy ? "polite" : undefined}
        >
          {mediaUploadBusy && (
            <span className="mb-1 block font-medium text-amber-900">A enviar a imagem para o repositório (Git)…</span>
          )}
          <span className="font-medium">Colar e carregar imagem: </span>
          são enviadas para{" "}
          <code className="rounded bg-amber-100/60 px-0.5 text-[0.7rem]">src/assets/media/</code> (aparecem na Central
          de Mídia) desde que o token e o repositório alvo estejam em Configurações. Docs/Word: o HTML colado é limpo.{" "}
          <span className="font-medium">Texto alternativo</span> obrigatório (SEO e acessibilidade). A{" "}
          <span className="font-medium">galeria</span> insere ficheiros já existentes nessa pasta.
        </p>
        <div className="editor-wp-canvas max-h-[min(70vh,44rem)] overflow-y-auto border-t border-slate-100/80 bg-white">
          <EditorContent editor={editor} className="px-3 py-3 sm:px-5 sm:py-4" />
        </div>
      </div>
      <MediaGalleryModal open={galleryOpen} onClose={() => setGalleryOpen(false)} editor={editor} />
    </>
  );
}
