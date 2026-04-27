import type { Editor } from "@tiptap/core";
import { isValidYoutubeUrl } from "@tiptap/extension-youtube";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Images,
  Italic,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  Table2,
  Underline,
  Upload,
  Video,
} from "lucide-react";
import type { RefObject, ReactNode } from "react";
import { promptAltRequired } from "./image-alt-utils";
import { isValidVimeoUrl } from "./tiptap-vimeo";

const DEFAULT_INP_COLOR = "#1e293b";

/** Normaliza cor para o input type="color" (hex #rrggbb). */
function toHex6ForInput(s: string | undefined): string {
  if (!s) return DEFAULT_INP_COLOR;
  const t = s.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) {
    return t.toLowerCase();
  }
  const rgb = t.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    const h = (n: string) =>
      Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, "0");
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return DEFAULT_INP_COLOR;
}

function TextColorControl({ editor }: { editor: Editor }) {
  const colorHex = useEditorState({
    editor,
    selector: ({ editor: ed }) => toHex6ForInput(ed.getAttributes("textStyle").color as string | undefined),
  });
  return (
    <div className="inline-flex items-center gap-0.5" role="group" aria-label="Cor do texto">
      <label
        className="inline-flex h-8 w-9 cursor-pointer items-stretch justify-center overflow-hidden rounded border border-slate-200/90 bg-white shadow-sm"
        title="Cor do texto"
      >
        <span className="sr-only">Escolher cor do texto</span>
        <input
          type="color"
          className="h-8 min-h-0 w-full min-w-0 cursor-pointer border-0 p-0 [color-scheme:light]"
          value={colorHex}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/i.test(v)) {
              editor.chain().focus().setColor(v.toLowerCase()).run();
            }
          }}
        />
      </label>
      <BarBtn
        title="Repor cor do texto (padrão)"
        onClick={() => editor.chain().focus().unsetColor().run()}
      >
        <Eraser className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Repor cor</span>
      </BarBtn>
    </div>
  );
}

type Props = {
  editor: Editor;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Abre o modal da galeria (ficheiros em `src/assets/media/` no repositório). */
  onMediaGallery?: () => void;
  /** Enquanto um ficheiro está a ser enviado para o repositório. */
  imageUploadDisabled?: boolean;
};

function insertImageFromUrl(editor: Editor) {
  const u = window.prompt("URL da imagem");
  if (u === null) return;
  const src = u.trim();
  if (!src) return;
  const alt = promptAltRequired("Texto alternativo (obrigatório) — imagem a partir de URL:");
  if (alt === null) return;
  editor.chain().focus().setImage({ src, alt }).run();
}

/**
 * YouTube (URL de vídeo, curta ou de embed) ou Vimeo (página do vídeo ou player).
 */
function insertVideoFromUrl(editor: Editor) {
  const raw = window.prompt(
    "URL do vídeo (YouTube ou Vimeo)",
    "https://www.youtube.com/watch?v= ou https://vimeo.com/…",
  );
  if (raw === null) return;
  const url = raw.trim();
  if (!url) return;
  if (isValidYoutubeUrl(url)) {
    const ok = editor.chain().focus().setYoutubeVideo({ src: url }).run();
    if (!ok) {
      window.alert("Não foi possível incorporar este link do YouTube.");
    }
    return;
  }
  if (isValidVimeoUrl(url)) {
    const ok = editor.chain().focus().setVimeoVideo({ src: url }).run();
    if (!ok) {
      window.alert("Não foi possível incorporar este link do Vimeo.");
    }
    return;
  }
  window.alert("Indica um URL válido de YouTube (youtube.com ou youtu.be) ou Vimeo (vimeo.com/…).");
}

function clearFormatting(editor: Editor) {
  if (editor.isActive("heading")) {
    editor.chain().focus().setParagraph().run();
  }
  editor.chain().focus().unsetColor().unsetAllMarks().run();
  let guard = 0;
  while (guard < 12 && (editor.isActive("bulletList") || editor.isActive("orderedList"))) {
    if (!editor.can().liftListItem("listItem")) {
      break;
    }
    editor.chain().focus().liftListItem("listItem").run();
    guard += 1;
  }
}

function BarBtn({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded border px-1.5 text-sm transition",
        active
          ? "border-slate-800 bg-slate-800 text-white shadow-inner"
          : "border-slate-200/90 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50",
        disabled ? "cursor-not-allowed opacity-40" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Barra de ferramentas estilo clássico WordPress, com ícones Lucide.
 */
export function MenuBar({ editor, fileInputRef, onMediaGallery, imageUploadDisabled = false }: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-slate-200/90 bg-slate-50/95 px-2 py-1.5"
      role="toolbar"
      aria-label="Formatação do conteúdo"
    >
      <BarBtn
        title="Negrito (Ctrl+B)"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Negrito</span>
      </BarBtn>
      <BarBtn
        title="Itálico (Ctrl+I)"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Itálico</span>
      </BarBtn>
      <BarBtn
        title="Sublinhado (Ctrl+U)"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Sublinhado</span>
      </BarBtn>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <BarBtn
        title="Título 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">H1</span>
      </BarBtn>
      <BarBtn
        title="Título 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">H2</span>
      </BarBtn>
      <BarBtn
        title="Título 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">H3</span>
      </BarBtn>
      <BarBtn
        title="Título 4"
        active={editor.isActive("heading", { level: 4 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
      >
        <Heading4 className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">H4</span>
      </BarBtn>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <TextColorControl editor={editor} />

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <BarBtn
        title="Lista com marcadores"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Lista com marcadores</span>
      </BarBtn>
      <BarBtn
        title="Lista numerada"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Lista numerada</span>
      </BarBtn>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <BarBtn
        title="Vídeo incorporado (YouTube ou Vimeo)"
        onClick={() => insertVideoFromUrl(editor)}
      >
        <Video className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Vídeo (YouTube ou Vimeo)</span>
      </BarBtn>
      <BarBtn
        title="Inserir link"
        active={editor.isActive("link")}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("URL do link", prev || "https://");
          if (url === null) return;
          if (url.trim() === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
        }}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Link</span>
      </BarBtn>
      <BarBtn
        title="Inserir imagem por URL (texto alternativo obrigatório)"
        onClick={() => insertImageFromUrl(editor)}
      >
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Imagem (URL)</span>
      </BarBtn>
      <BarBtn
        disabled={imageUploadDisabled}
        title="Carregar imagem (envia para o repositório, pasta src/assets/media; alternativo obrigatório)"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Carregar imagem</span>
      </BarBtn>
      {onMediaGallery ? (
        <BarBtn title="Galeria — ficheiros já em src/assets/media (alternativo ao inserir)" onClick={onMediaGallery}>
          <Images className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Galeria</span>
        </BarBtn>
      ) : null}

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <BarBtn
        title="Tabela 3×3 (com cabeçalho)"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <Table2 className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Tabela</span>
      </BarBtn>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <BarBtn
        title="Limpar formatação (negrito, títulos, listas, marcas no bloco…)"
        onClick={() => clearFormatting(editor)}
      >
        <RemoveFormatting className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Limpar formatação</span>
      </BarBtn>
    </div>
  );
}
