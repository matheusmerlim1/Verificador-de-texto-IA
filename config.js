/**
 * config.js — Configuração da instância
 *
 * Carregado ANTES de core.js. Controla se a ferramenta pede a chave ao
 * usuário ou já usa uma chave cadastrada.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  MODO 1 — chave do usuário (padrão, seguro para site público)    │
 * │  apiKey: ''                                                      │
 * │  Cada visitante digita a própria chave; fica no localStorage     │
 * │  dele e nunca toca o seu console da Anthropic.                   │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  MODO 2 — chave cadastrada (sua chave, uso restrito)            │
 * │  apiKey: 'sk-ant-api03-...'                                      │
 * │  Ninguém precisa digitar nada. TODO consumo é cobrado de você.   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ LEIA ANTES DE USAR O MODO 2
 *
 * Este é um site estático: o arquivo abaixo é baixado pelo navegador de
 * QUEM ABRIR A PÁGINA. A chave fica visível em "Ver código-fonte" e na
 * aba Rede do DevTools. Não existe forma de esconder uma chave em site
 * estático — nem ofuscando, nem em outro arquivo, nem em base64.
 *
 * Repositório privado NÃO resolve: o GitHub Pages serve a página
 * publicamente mesmo quando o repositório é privado (páginas privadas
 * exigem plano Enterprise). Privado protege o código-fonte, não o site.
 *
 * Use o modo 2 apenas quando:
 *   • rodando em localhost, na sua máquina; ou
 *   • a página estiver atrás de autenticação de verdade; ou
 *   • a chave for descartável, com limite de gasto baixo configurado em
 *     console.anthropic.com → Limits, e você aceitar perdê-la.
 *
 * Se a chave vazar: console.anthropic.com → API Keys → Revoke.
 */

window.DLM_CONFIG = {

  /** Chave da Anthropic. Vazio = cada usuário informa a sua. */
  apiKey: '',

  /** Modelo padrão. Veja MODELS em core.js. */
  model: 'claude-sonnet-5',

  /**
   * true  → esconde a barra de chave (o usuário não vê nem troca a chave)
   * false → mostra a barra já preenchida, permitindo trocar
   * Só tem efeito quando apiKey está preenchida.
   */
  lockKey: true,

  /**
   * Rótulo mostrado no lugar da barra de chave no modo cadastrado.
   * Serve para deixar explícito de quem é a cota sendo consumida.
   */
  ownerLabel: 'Chave cadastrada do projeto',
};
