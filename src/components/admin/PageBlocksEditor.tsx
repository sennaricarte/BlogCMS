import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Heading,
  HelpCircle,
  Image as ImageIcon,
  Link2,
  List,
  Mail,
  MapPin,
  Megaphone,
  MessageSquareQuote,
  Minus,
  QrCode,
  Trash2,
  Video,
  LayoutTemplate,
} from "lucide-react";
import { buildDefaultContactPageTemplate } from "../../lib/page-templates";
import type { PageBlock } from "../../lib/page-blocks.zod";

const BTNS: Array<{
  type: PageBlock["type"];
  label: string;
  description: string;
  icon: typeof Heading;
}> = [
  { type: "hero", label: "Título de página", description: "Hero", icon: Heading },
  { type: "contactForm", label: "Formulário de contacto", description: "Nome, e-mail, assunto, mensagem", icon: Mail },
  { type: "linksList", label: "Lista de links", description: "Botões (estilo link tree)", icon: List },
  { type: "faq", label: "FAQ (SEO)", description: "Perguntas e respostas + schema", icon: HelpCircle },
  { type: "qrCode", label: "QR Code", description: "URL personalizada ou página", icon: QrCode },
  { type: "mapLocation", label: "Mapa local", description: "Endereço, rotas, mapa", icon: MapPin },
  { type: "cta", label: "Chamada (CTA)", description: "Título, texto e botões", icon: Megaphone },
  { type: "image", label: "Imagem", description: "Foto com legenda e alt", icon: ImageIcon },
  { type: "quote", label: "Citação", description: "Depoimento ou destaque", icon: MessageSquareQuote },
  { type: "separator", label: "Separador", description: "Linha, pontos ou espaço", icon: Minus },
  { type: "videoEmbed", label: "Vídeo", description: "YouTube ou Vimeo", icon: Video },
];

function blockSummary(b: PageBlock): string {
  if (b.type === "hero") return b.title.slice(0, 48) + (b.title.length > 48 ? "…" : "");
  if (b.type === "contactForm") return (b.title || "Formulário").slice(0, 48);
  if (b.type === "linksList") return `${b.links.length} botão(ões)` + (b.title ? ` · ${b.title}` : "");
  if (b.type === "faq")
    return (
      `${b.items.length} pergunta(s)` +
      (b.horarioFuncionamento ? " · horário" : "") +
      (b.title ? ` · ${b.title}` : "")
    );
  if (b.type === "qrCode") {
    const u = b.targetUrl?.trim();
    if (!u) return "URL desta página";
    return u.length > 44 ? `${u.slice(0, 44)}…` : u;
  }
  if (b.type === "mapLocation") return b.address.slice(0, 44) + (b.address.length > 44 ? "…" : "");
  if (b.type === "cta") return b.title.slice(0, 48) + (b.title.length > 48 ? "…" : "");
  if (b.type === "image") return (b.alt || b.src).slice(0, 48);
  if (b.type === "quote") return b.text.slice(0, 48) + (b.text.length > 48 ? "…" : "");
  if (b.type === "separator") return b.style === "dots" ? "Pontos" : b.style === "space" ? "Espaço" : "Linha";
  if (b.type === "videoEmbed") return `${b.provider} · ${b.videoId}`;
  return "";
}

function blockKindLabel(b: PageBlock): string {
  if (b.type === "hero") return "Título de página";
  if (b.type === "contactForm") return "Formulário de contacto";
  if (b.type === "linksList") return "Lista de links";
  if (b.type === "faq") return "FAQ (SEO)";
  if (b.type === "qrCode") return "QR Code";
  if (b.type === "mapLocation") return "Mapa e local";
  if (b.type === "cta") return "Chamada (CTA)";
  if (b.type === "image") return "Imagem";
  if (b.type === "quote") return "Citação";
  if (b.type === "separator") return "Separador";
  if (b.type === "videoEmbed") return "Vídeo incorporado";
  return "";
}

function parseOptCoord(s: string): number | undefined {
  const t = s.trim().replace(",", ".");
  if (!t) return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function InputRow({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function BlockFields({ block, onChange }: { block: PageBlock; onChange: (b: PageBlock) => void }) {
  const id = block.id;

  if (block.type === "hero") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <InputRow id={`${id}-t`} label="Título" value={block.title} onChange={(title) => onChange({ ...block, title })} />
        </div>
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-s`}
            label="Subtítulo (opcional)"
            value={block.subtitle || ""}
            onChange={(subtitle) => onChange({ ...block, subtitle: subtitle || undefined })}
          />
        </div>
      </div>
    );
  }
  if (block.type === "contactForm") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-ht`}
            label="Título da secção (opcional)"
            value={block.title || ""}
            onChange={(title) => onChange({ ...block, title: title || undefined })}
          />
        </div>
        <InputRow
          id={`${id}-nl`}
          label="Etiqueta: Nome"
          value={block.nameLabel}
          onChange={(nameLabel) => onChange({ ...block, nameLabel })}
        />
        <InputRow
          id={`${id}-el`}
          label="Etiqueta: E-mail"
          value={block.emailLabel}
          onChange={(emailLabel) => onChange({ ...block, emailLabel })}
        />
        <InputRow
          id={`${id}-sl`}
          label="Etiqueta: Assunto"
          value={block.subjectLabel}
          onChange={(subjectLabel) => onChange({ ...block, subjectLabel })}
        />
        <InputRow
          id={`${id}-ml`}
          label="Etiqueta: Mensagem"
          value={block.messageLabel}
          onChange={(messageLabel) => onChange({ ...block, messageLabel })}
        />
        <InputRow
          id={`${id}-sub`}
          label="Texto do botão de envio"
          value={block.submitLabel}
          onChange={(submitLabel) => onChange({ ...block, submitLabel })}
        />
        <InputRow
          id={`${id}-em`}
          label="E-mail destino (mailto, opcional)"
          value={block.contactEmail || ""}
          onChange={(contactEmail) => onChange({ ...block, contactEmail: contactEmail || undefined })}
        />
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-pn`}
            label="Nota de privacidade (opcional)"
            value={block.privacyNote || ""}
            onChange={(privacyNote) => onChange({ ...block, privacyNote: privacyNote || undefined })}
          />
        </div>
      </div>
    );
  }
  if (block.type === "linksList") {
    return (
      <div className="space-y-3">
        <InputRow
          id={`${id}-lt`}
          label="Título da secção (opcional)"
          value={block.title || ""}
          onChange={(title) => onChange({ ...block, title: title || undefined })}
        />
        {block.links.map((link, idx) => (
          <div key={idx} className="grid gap-1 rounded border border-slate-100 p-2 sm:grid-cols-2">
            <InputRow
              id={`${id}-lk-${idx}-l`}
              label="Texto do botão"
              value={link.label}
              onChange={(label) => {
                const links = block.links.map((x, j) => (j === idx ? { ...x, label } : x));
                onChange({ ...block, links });
              }}
            />
            <InputRow
              id={`${id}-lk-${idx}-u`}
              label="URL"
              value={link.url}
              onChange={(url) => {
                const links = block.links.map((x, j) => (j === idx ? { ...x, url } : x));
                onChange({ ...block, links });
              }}
            />
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => onChange({ ...block, links: block.links.filter((_, j) => j !== idx) })}
                className="text-xs text-red-600 hover:underline"
              >
                Remover botão
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({ ...block, links: [...block.links, { label: "Novo link", url: "https://" }] })
          }
          className="inline-flex items-center gap-1 text-sm text-[var(--client-color-primary)] hover:underline"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          Adicionar botão
        </button>
      </div>
    );
  }
  if (block.type === "faq") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          As perguntas com resposta são enviadas automaticamente no JSON-LD de FAQ (Google). Usa respostas claras
          (até 1–2 frases) por Q.
        </p>
        <InputRow
          id={`${id}-ft`}
          label="Título da secção (opcional)"
          value={block.title || ""}
          onChange={(title) => onChange({ ...block, title: title || undefined })}
        />
        <div>
          <label htmlFor={`${id}-horario`} className="block text-xs font-medium text-slate-600">
            Horário de funcionamento (opcional)
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            Exibido em destaque no site acima das perguntas. As entradas do acordeão abaixo é que alimentam o FAQ no
            Google.
          </p>
          <textarea
            id={`${id}-horario`}
            value={block.horarioFuncionamento || ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ ...block, horarioFuncionamento: v.trim() === "" ? undefined : v });
            }}
            rows={2}
            placeholder="Ex.: Segunda a sexta, 9h–18h. Sábado com agendamento."
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        {block.items.map((item, idx) => (
          <div key={idx} className="rounded border border-slate-100 p-2">
            <p className="text-xs text-slate-500">Pergunta {idx + 1}</p>
            <InputRow
              id={`${id}-q-${idx}`}
              label="Pergunta"
              value={item.question}
              onChange={(question) => {
                const items = block.items.map((x, j) => (j === idx ? { ...x, question } : x));
                onChange({ ...block, items });
              }}
            />
            <label htmlFor={`${id}-a-${idx}`} className="mt-1 block text-xs font-medium text-slate-600">
              Resposta
            </label>
            <textarea
              id={`${id}-a-${idx}`}
              value={item.answer}
              onChange={(e) => {
                const v = e.target.value;
                const items = block.items.map((x, j) => (j === idx ? { ...x, answer: v } : x));
                onChange({ ...block, items });
              }}
              rows={3}
              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== idx) })}
              className="mt-1 text-xs text-red-600 hover:underline"
            >
              Remover pergunta
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({ ...block, items: [...block.items, { question: "Nova pergunta", answer: "Resposta." }] })
          }
          className="text-sm text-[var(--client-color-primary)] hover:underline"
        >
          + Adicionar pergunta
        </button>
      </div>
    );
  }
  if (block.type === "qrCode") {
    return (
      <div className="space-y-2">
        <InputRow
          id={`${id}-url`}
          label="URL a codificar (vazio = URL canónica desta página no site)"
          value={block.targetUrl}
          onChange={(targetUrl) => onChange({ ...block, targetUrl })}
        />
        <InputRow
          id={`${id}-cap`}
          label="Texto de apoio (opcional, abaixo do QR)"
          value={block.caption || ""}
          onChange={(caption) => onChange({ ...block, caption: caption || undefined })}
        />
      </div>
    );
  }
  if (block.type === "mapLocation") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-mt`}
            label="Título (opcional)"
            value={block.title || ""}
            onChange={(title) => onChange({ ...block, title: title || undefined })}
          />
        </div>
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-addr`}
            label="Endereço ou ponto a mostrar (obrigatório no embed se não tiveres coordenadas)"
            value={block.address}
            onChange={(address) => onChange({ ...block, address })}
          />
        </div>
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-dir`}
            label="Rótulo do botão (ex. Como chegar)"
            value={block.directionsLabel}
            onChange={(directionsLabel) => onChange({ ...block, directionsLabel })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-lat`} className="block text-xs font-medium text-slate-600">
            Latitude (opcional, mapa interativo OpenStreetMap)
          </label>
          <input
            id={`${id}-lat`}
            value={block.latitude !== undefined && !Number.isNaN(block.latitude) ? String(block.latitude) : ""}
            onChange={(e) => onChange({ ...block, latitude: parseOptCoord(e.target.value) })}
            className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            inputMode="decimal"
            placeholder="ex: 38.7223"
          />
        </div>
        <div>
          <label htmlFor={`${id}-lng`} className="block text-xs font-medium text-slate-600">
            Longitude (opcional)
          </label>
          <input
            id={`${id}-lng`}
            value={block.longitude !== undefined && !Number.isNaN(block.longitude) ? String(block.longitude) : ""}
            onChange={(e) => onChange({ ...block, longitude: parseOptCoord(e.target.value) })}
            className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            inputMode="decimal"
            placeholder="ex: -9.1393"
          />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">
          Com lat/long o mapa usa Leaflet (OSM). Só com endereço, mostramos o iframe do Google; o botão {block.directionsLabel || "Como chegar"} abre a rota no Google Maps.
        </p>
      </div>
    );
  }
  if (block.type === "cta") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <InputRow id={`${id}-ct`} label="Título" value={block.title} onChange={(title) => onChange({ ...block, title })} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-ctx`} className="block text-xs font-medium text-slate-600">
            Texto de apoio (opcional)
          </label>
          <textarea
            id={`${id}-ctx`}
            value={block.text || ""}
            onChange={(e) => onChange({ ...block, text: e.target.value || undefined })}
            rows={3}
            className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        <InputRow
          id={`${id}-cp1`}
          label="Botão principal — texto"
          value={block.primaryLabel}
          onChange={(primaryLabel) => onChange({ ...block, primaryLabel })}
        />
        <InputRow
          id={`${id}-cu1`}
          label="Botão principal — URL"
          value={block.primaryUrl}
          onChange={(primaryUrl) => onChange({ ...block, primaryUrl })}
        />
        <InputRow
          id={`${id}-cp2`}
          label="Botão secundário — texto (opcional)"
          value={block.secondaryLabel || ""}
          onChange={(secondaryLabel) => onChange({ ...block, secondaryLabel: secondaryLabel || undefined })}
        />
        <InputRow
          id={`${id}-cu2`}
          label="Botão secundário — URL (opcional)"
          value={block.secondaryUrl || ""}
          onChange={(secondaryUrl) => onChange({ ...block, secondaryUrl: secondaryUrl || undefined })}
        />
      </div>
    );
  }
  if (block.type === "image") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-isrc`}
            label="URL ou caminho da imagem (ex. /media/foto.jpg)"
            value={block.src}
            onChange={(src) => onChange({ ...block, src })}
          />
        </div>
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-ialt`}
            label="Texto alternativo (alt) — obrigatório para acessibilidade"
            value={block.alt}
            onChange={(alt) => onChange({ ...block, alt })}
          />
        </div>
        <div className="sm:col-span-2">
          <InputRow
            id={`${id}-icap`}
            label="Legenda (opcional)"
            value={block.caption || ""}
            onChange={(caption) => onChange({ ...block, caption: caption || undefined })}
          />
        </div>
      </div>
    );
  }
  if (block.type === "quote") {
    return (
      <div className="space-y-2">
        <div>
          <label htmlFor={`${id}-qt`} className="block text-xs font-medium text-slate-600">
            Citação
          </label>
          <textarea
            id={`${id}-qt`}
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={4}
            className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        <InputRow
          id={`${id}-qa`}
          label="Autor (opcional)"
          value={block.author || ""}
          onChange={(author) => onChange({ ...block, author: author || undefined })}
        />
        <InputRow
          id={`${id}-qr`}
          label="Função ou empresa (opcional)"
          value={block.authorRole || ""}
          onChange={(authorRole) => onChange({ ...block, authorRole: authorRole || undefined })}
        />
      </div>
    );
  }
  if (block.type === "separator") {
    return (
      <div className="space-y-2">
        <div>
          <label htmlFor={`${id}-seps`} className="block text-xs font-medium text-slate-600">
            Estilo
          </label>
          <select
            id={`${id}-seps`}
            value={block.style || "line"}
            onChange={(e) => {
              const v = e.target.value as "line" | "dots" | "space";
              onChange({ ...block, style: v });
            }}
            className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="line">Linha</option>
            <option value="dots">Três pontos</option>
            <option value="space">Apenas espaço vertical</option>
          </select>
        </div>
        <InputRow
          id={`${id}-sepl`}
          label="Nome para acessibilidade (opcional; deixa vazio se for decorativo)"
          value={block.label || ""}
          onChange={(label) => onChange({ ...block, label: label || undefined })}
        />
      </div>
    );
  }
  if (block.type === "videoEmbed") {
    return (
      <div className="space-y-2">
        <div>
          <label htmlFor={`${id}-vpr`} className="block text-xs font-medium text-slate-600">
            Plataforma
          </label>
          <select
            id={`${id}-vpr`}
            value={block.provider}
            onChange={(e) => {
              const provider = e.target.value as "youtube" | "vimeo";
              onChange({ ...block, provider });
            }}
            className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="youtube">YouTube</option>
            <option value="vimeo">Vimeo</option>
          </select>
        </div>
        <InputRow
          id={`${id}-vid`}
          label="ID do vídeo (ex. YouTube: 11 caracteres do URL; Vimeo: só o número do vídeo)"
          value={block.videoId}
          onChange={(videoId) => onChange({ ...block, videoId })}
        />
        <InputRow
          id={`${id}-vtt`}
          label="Título descritivo (usado no iframe, para leitores de ecrã)"
          value={block.title}
          onChange={(title) => onChange({ ...block, title })}
        />
        <p className="text-xs text-slate-500">
          Ex.: em{" "}
          <span className="font-mono text-[11px]">youtube.com/watch?v=ScMzIwxPSPk</span> o ID é ScMzIwxPSPk.
        </p>
      </div>
    );
  }
  return null;
}

type Props = {
  hiddenInputId?: string;
  /** Chamado em cada alteração da lista (útil para pré-visualização em tempo real). */
  onBlocksChange?: (blocks: PageBlock[]) => void;
  /** Só ecrã "Nova página": botão de template de contacto. */
  showContactTemplateButton?: boolean;
};

export function PageBlocksEditor({
  hiddenInputId = "p-page-blocks",
  onBlocksChange,
  showContactTemplateButton = false,
}: Props) {
  const onChangeRef = useRef(onBlocksChange);
  onChangeRef.current = onBlocksChange;
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const writeHidden = useCallback(
    (next: PageBlock[]) => {
      const el = document.getElementById(hiddenInputId) as HTMLInputElement | null;
      if (el) el.value = JSON.stringify(next);
    },
    [hiddenInputId],
  );

  const readHiddenBlocks = useCallback(() => {
    const el = document.getElementById(hiddenInputId) as HTMLInputElement | null;
    if (!el?.value || el.value === "[]") return;
    try {
      const j = JSON.parse(el.value) as unknown;
      if (Array.isArray(j) && j.length > 0) setBlocks(j as PageBlock[]);
    } catch {
      /* ignore */
    }
  }, [hiddenInputId]);

  useEffect(() => {
    readHiddenBlocks();
    const t1 = window.setTimeout(readHiddenBlocks, 50);
    const t2 = window.setTimeout(readHiddenBlocks, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [readHiddenBlocks]);

  useEffect(() => {
    const h = (e: Event) => {
      const ce = e as CustomEvent<{ blocks: PageBlock[] }>;
      if (ce.detail?.blocks) {
        setBlocks(ce.detail.blocks);
        writeHidden(ce.detail.blocks);
      }
    };
    window.addEventListener("blogcms-page-blocks", h);
    return () => window.removeEventListener("blogcms-page-blocks", h);
  }, [writeHidden]);

  useEffect(() => {
    writeHidden(blocks);
  }, [blocks, writeHidden]);

  useEffect(() => {
    onChangeRef.current?.(blocks);
  }, [blocks]);

  const add = (t: PageBlock["type"]) => {
    setBlocks((prev) => [...prev, createDefaultBlock(t)]);
    setOpenId(null);
  };

  const applyContactTemplate = useCallback(() => {
    setBlocks((prev) => {
      if (prev.length > 0) {
        const ok = window.confirm(
          "Substituir os blocos actuais pelo template de contacto? Podes voltar atrás recarregando a página se ainda não guardaste.",
        );
        if (!ok) return prev;
      }
      const next = buildDefaultContactPageTemplate();
      queueMicrotask(() => setOpenId(next[0]?.id ?? null));
      return next;
    });
  }, []);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return next;
    });
  };

  const onDragStart = (i: number) => setDragIndex(i);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (i: number) => {
    if (dragIndex === null || dragIndex === i) {
      setDragIndex(null);
      return;
    }
    move(dragIndex, i);
    setDragIndex(null);
  };

  return (
    <div className="min-w-0 space-y-6">
      {showContactTemplateButton && (
        <div
          className="relative overflow-hidden rounded-2xl border-2 border-[var(--primary-color)]/35 bg-gradient-to-br from-[var(--primary-color)]/[0.07] via-white to-white p-4 shadow-sm sm:p-5"
          role="region"
          aria-label="Template de página de contacto"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">Página de contacto em um clique</h2>
              <p className="mt-1 text-sm text-slate-600">
                Insere um hero, o formulário com campos padrão, botões (WhatsApp e Instagram de exemplo), mapa e FAQ.
                Os blocos aparecem de seguida na lista; edita textos, URL e coordenadas como quiseres. As cores seguem a
                <span className="whitespace-nowrap"> cor primária em </span>
                Aparência.
              </p>
            </div>
            <button
              type="button"
              onClick={applyContactTemplate}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--primary-color)] px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-95 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-slate-900 sm:min-w-[15rem]"
            >
              <LayoutTemplate className="h-5 w-5 shrink-0" aria-hidden />
              Usar Template de Contato
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-slate-800">Adicionar Elemento</h2>
        <p className="text-xs text-slate-500">Clica num componente para o adicionar ao fim da página. Podes reordenar pelo ícone à esquerda.</p>
        <ul
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
          role="list"
          aria-label="Adicionar bloco"
        >
          {BTNS.map((b) => {
            const Icon = b.icon;
            return (
              <li key={b.type}>
                <button
                  type="button"
                  onClick={() => add(b.type)}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 bg-slate-50/80 px-3 py-4 text-center transition hover:border-[var(--client-color-primary)] hover:bg-white"
                >
                  <Icon className="h-6 w-6 text-slate-700" strokeWidth={1.75} aria-hidden />
                  <span className="text-sm font-medium text-slate-800">{b.label}</span>
                  <span className="text-xs text-slate-500">{b.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {blocks.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-800">Pré-visualização e edição</h3>
          <p className="text-xs text-slate-500">Lista dos blocos desta página. Expande para editar, ou remove.</p>
          <div className="mt-2 space-y-2" role="list" aria-label="Blocos adicionados">
            {blocks.map((block, i) => (
              <div
                key={block.id}
                role="listitem"
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                onDragOver={onDragOver}
                onDrop={() => onDrop(i)}
              >
                <div className="flex items-stretch">
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(i));
                      e.dataTransfer.effectAllowed = "move";
                      onDragStart(i);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className="flex w-9 shrink-0 cursor-grab select-none items-center justify-center border-r border-slate-200 bg-slate-50 text-slate-500 active:cursor-grabbing hover:bg-slate-100"
                    title="Arrastar para reordenar"
                    role="button"
                    tabIndex={0}
                    aria-label="Arrastar bloco (reordenar)"
                  >
                    <GripVertical className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                      onClick={() => setOpenId(openId === block.id ? null : block.id)}
                      aria-expanded={openId === block.id}
                    >
                      <span className="min-w-0 flex-1 text-sm text-slate-800">
                        <span className="font-semibold text-slate-900">{blockKindLabel(block)}</span>
                        <span className="ml-1.5 block truncate text-slate-600 sm:inline sm:ml-1">
                          {blockSummary(block) || "— clica para editar"}
                        </span>
                      </span>
                      {openId === block.id ? (
                        <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                    </button>
                  </div>
                  <div className="flex shrink-0 border-l border-slate-200">
                    <button
                      type="button"
                      className="px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Mover bloco para cima"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                      onClick={() => move(i, i + 1)}
                      disabled={i === blocks.length - 1}
                      aria-label="Mover bloco para baixo"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="px-2 text-red-600 hover:bg-red-50"
                      onClick={() => setBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                      aria-label="Remover bloco"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {openId === block.id && (
                  <div className="border-t border-slate-100 p-3">
                    <BlockFields
                      block={block}
                      onChange={(b) => setBlocks((prev) => prev.map((x) => (x.id === b.id ? b : x)))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {blocks.length === 0 && <p className="text-sm text-slate-500">Ainda sem blocos. Adiciona um elemento acima.</p>}
    </div>
  );
}
