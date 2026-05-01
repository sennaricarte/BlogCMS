import type { PageBlock } from "./page-blocks.zod";
import { newBlockId } from "./page-blocks.factories";

/**
 * Blocos pré-configurados para a página "Contato" (construtor).
 * Ordem: hero → formulário → links (redes) → mapa → FAQ.
 */
export function buildDefaultContactPageTemplate(): PageBlock[] {
  return [
    {
      id: newBlockId(),
      type: "hero",
      title: "Entre em Contato",
      description: "Estamos prontos para tirar suas dúvidas e ajudar no seu projeto.",
      subtitle: undefined,
    },
    {
      id: newBlockId(),
      type: "contactForm",
      title: "Envie uma mensagem",
      nameLabel: "Nome",
      emailLabel: "E-mail",
      subjectLabel: "Assunto",
      messageLabel: "Mensagem",
      submitLabel: "Enviar",
      contactEmail: "",
      privacyNote: "Ao enviar, o teu programa de e-mail abre com a mensagem (mailto). Ajusta o e-mail de destino nas definições do bloco, se o adicionares.",
    },
    {
      id: newBlockId(),
      type: "linksList",
      title: "Outros canais",
      links: [
        { label: "WhatsApp", url: "https://wa.me/5511999999999" },
        { label: "Instagram", url: "https://www.instagram.com/" },
      ],
    },
    {
      id: newBlockId(),
      type: "mapLocation",
      title: "Onde estamos",
      address: "Praça do Comércio, 1100-148 Lisboa, Portugal",
      directionsLabel: "Como chegar",
      latitude: 38.7075,
      longitude: -9.1366,
    },
    {
      id: newBlockId(),
      type: "faq",
      title: "Dúvidas frequentes",
      horarioFuncionamento:
        "Segunda a sexta, 9h–18h. Sábado apenas com agendamento prévio (edite estes horários no bloco, em «Horário de funcionamento»).",
      items: [
        {
          question: "Fazem orçamento sem compromisso?",
          answer:
            "Podes pedir esclarecimentos iniciais sem custo, conforme a nossa política; ajusta este texto à tua realidade comercial.",
        },
        {
          question: "Vocês atendem em qual região?",
          answer: "Exemplo: atuamos em todo o país; para casos presenciais, indica a região ou combina o detalhe por mensagem.",
        },
        {
          question: "Como responde após o contacto?",
          answer: "Exemplo: procuramos responder em até 1 dia útil. Podes afinar o prazo e o canal (e-mail, telefone, etc.).",
        },
      ],
    },
  ];
}
