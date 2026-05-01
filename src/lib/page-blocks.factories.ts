import type { PageBlock } from "./page-blocks.zod";

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `blk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function newBlockId(): string {
  return newId();
}

export function createDefaultBlock(type: PageBlock["type"]): PageBlock {
  switch (type) {
    case "hero":
      return {
        id: newId(),
        type: "hero",
        title: "Título da secção",
        description: "Subtítulo ou descrição curta.",
        subtitle: undefined,
      };
    case "contactForm":
      return {
        id: newId(),
        type: "contactForm",
        title: "Contacto",
        nameLabel: "Nome",
        emailLabel: "E-mail",
        subjectLabel: "Assunto",
        messageLabel: "Mensagem",
        submitLabel: "Enviar",
        contactEmail: "",
        privacyNote: "Ao enviar, abre o teu programa de e-mail (mailto).",
      };
    case "linksList":
      return {
        id: newId(),
        type: "linksList",
        title: "Links",
        links: [
          { label: "Exemplo 1", url: "https://example.com" },
          { label: "Exemplo 2", url: "https://example.com" },
        ],
      };
    case "faq":
      return {
        id: newId(),
        type: "faq",
        title: "Perguntas frequentes",
        items: [
          { question: "Como funciona este serviço?", answer: "Descrição breve da resposta para o visitante." },
          { question: "Quais são os prazos?", answer: "Indica os prazos ou contacta-nos para um orçamento." },
        ],
      };
    case "qrCode":
      return {
        id: newId(),
        type: "qrCode",
        targetUrl: "",
        caption: "Aponta a câmara para aceder ao link.",
      };
    case "mapLocation":
      return {
        id: newId(),
        type: "mapLocation",
        title: "Localização",
        address: "Lisboa, Portugal",
        directionsLabel: "Como chegar",
      };
    case "cta":
      return {
        id: newId(),
        type: "cta",
        title: "Próximo passo",
        text: "Breve explicação do que acontece ao clicar.",
        primaryLabel: "Começar",
        primaryUrl: "/contato",
        secondaryLabel: "Saber mais",
        secondaryUrl: "/blog",
      };
    case "image":
      return {
        id: newId(),
        type: "image",
        src: "/favicon.svg",
        alt: "Imagem de exemplo",
        caption: "Legenda opcional (crédito ou descrição curta).",
      };
    case "quote":
      return {
        id: newId(),
        type: "quote",
        text: "Uma frase que transmite confiança ou o valor do teu serviço.",
        author: "Nome do autor",
        authorRole: "Função ou empresa",
      };
    case "separator":
      return {
        id: newId(),
        type: "separator",
        style: "line",
        label: "",
      };
    case "videoEmbed":
      return {
        id: newId(),
        type: "videoEmbed",
        title: "Vídeo de apresentação",
        provider: "youtube",
        videoId: "ScMzIwxPSPk",
      };
  }
}
