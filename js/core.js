/**
 * core.js — Núcleo compartilhado
 *
 * Estado da chave de API, chamada à Anthropic, utilitários de DOM
 * e helpers de renderização usados pelos modos "Texto" e "Código".
 *
 * Requer o header:  anthropic-dangerous-direct-browser-access: true
 * (obrigatório para chamadas diretas do browser pela Anthropic)
 */

'use strict';

// ════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════
const API_URL   = 'https://api.anthropic.com/v1/messages';
const LS_KEY    = 'dlm_anthropic_key';
const LS_MODEL  = 'dlm_model';
const MIN_WORDS = 20;

const MODELS = {
  'claude-sonnet-5':           'Sonnet 5 — equilíbrio (padrão)',
  'claude-opus-5':             'Opus 5 — máxima precisão',
  'claude-haiku-4-5-20251001': 'Haiku 4.5 — rápido e barato',
};
const DEFAULT_MODEL = 'claude-sonnet-5';

// ════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════
const CFG = (typeof window !== 'undefined' && window.DLM_CONFIG) || {};

/** true quando config.js traz uma chave cadastrada (modo "chave do dono"). */
const EMBEDDED_KEY = typeof CFG.apiKey === 'string' && CFG.apiKey.startsWith('sk-ant');

/**
 * Build privado: a barra de chave nunca aparece, tenha chave ou não.
 * Sem isto, um config.js ainda não preenchido cairia no fluxo público
 * e pediria a chave ao usuário — exatamente o que este build evita.
 */
const PRIVATE_BUILD = CFG.privateBuild === true;

const App = {
  // Chave cadastrada tem precedência sobre o que estiver no localStorage.
  apiKey: EMBEDDED_KEY ? CFG.apiKey : (localStorage.getItem(LS_KEY) || ''),
  model:  localStorage.getItem(LS_MODEL) || CFG.model || DEFAULT_MODEL,
  embedded: EMBEDDED_KEY,
  get keyOk() {
    return this.apiKey.startsWith('sk-ant') && this.apiKey.length > 20;
  },
};

// ════════════════════════════════════════════════
//  UTILITÁRIOS DOM
// ════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function show(id, display = 'block') {
  const el = $(id);
  if (el) el.style.display = display;
}
function hide(id) { show(id, 'none'); }

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function countWords(str) {
  return String(str || '').trim().split(/\s+/).filter(Boolean).length;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// ════════════════════════════════════════════════
//  ESCALAS DE COR E VEREDITO
// ════════════════════════════════════════════════
function getColor(score) {
  if (score <= 30) return '#27ae60';
  if (score <= 55) return '#e67e22';
  return '#c0392b';
}

function getVerdict(score) {
  if (score <= 20) return { label: 'PROVAVELMENTE HUMANO', color: '#27ae60' };
  if (score <= 40) return { label: 'INDICADORES HUMANOS',  color: '#2ecc71' };
  if (score <= 60) return { label: 'INCONCLUSIVO',         color: '#e67e22' };
  if (score <= 80) return { label: 'INDICADORES DE IA',    color: '#e67e22' };
  return              { label: 'PROVAVELMENTE IA',         color: '#c0392b' };
}

// ════════════════════════════════════════════════
//  BARRA DE API KEY (compartilhada pelos dois modos)
// ════════════════════════════════════════════════
function initApiKey() {
  const input = $('api-key-input');
  const badge = $('api-key-badge');
  const sel   = $('model-select');

  Object.entries(MODELS).forEach(([id, label]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  sel.value = App.model;
  sel.addEventListener('change', () => {
    App.model = sel.value;
    localStorage.setItem(LS_MODEL, App.model);
  });

  // ── Modo chave cadastrada ──────────────────────────────────
  // A chave veio de config.js. Não faz sentido pedir nada ao usuário,
  // e não gravamos no localStorage dele — a chave não é dele.
  if (EMBEDDED_KEY || PRIVATE_BUILD) {
    const bar = document.querySelector('.apikey-bar');

    if (EMBEDDED_KEY && CFG.lockKey === false) {
      // Build com chave, mas o dono quer poder trocá-la na tela.
      input.value = App.apiKey;
      setKeyStatus();
      return;
    }

    bar.classList.add('embedded');
    if (EMBEDDED_KEY) {
      bar.innerHTML =
        `<span class="apikey-label">🔑 ${escHtml(CFG.ownerLabel || 'Chave cadastrada')}</span>` +
        `<span class="apikey-badge ok">✅ Pronto para analisar</span>` +
        `<span class="apikey-hint">Nada a preencher. O consumo é faturado na conta do responsável por esta cópia.</span>`;
    } else {
      // Build privado sem chave: falta um passo de instalação, não é erro do usuário.
      bar.classList.add('unconfigured');
      bar.innerHTML =
        `<span class="apikey-label">🔑 Chave não configurada</span>` +
        `<span class="apikey-badge err">⚠️ Falta preencher config.js</span>` +
        `<span class="apikey-hint">Abra <code>config.js</code>, cole a chave em <code>apiKey</code> e recarregue a página (Ctrl+F5).</span>`;
    }
    // Recria o seletor de modelo, removido junto com o innerHTML.
    bar.appendChild(sel);
    return;
  }

  if (App.apiKey) {
    input.value = App.apiKey;
    setKeyStatus();
  }

  input.addEventListener('input', () => {
    App.apiKey = input.value.trim();
    localStorage.setItem(LS_KEY, App.apiKey);
    setKeyStatus();
    document.dispatchEvent(new CustomEvent('apikeychange'));
  });

  function setKeyStatus() {
    const key = App.apiKey;
    const ok  = App.keyOk;
    badge.className   = 'apikey-badge ' + (key ? (ok ? 'ok' : 'err') : 'idle');
    badge.textContent = key
      ? (ok ? '✅ Chave válida — salva no navegador' : '❌ Formato inválido')
      : 'Aguardando chave';
    input.className   = 'apikey-input ' + (ok ? 'valid' : '');
  }
}

// ════════════════════════════════════════════════
//  CHAMADA À API
// ════════════════════════════════════════════════

/**
 * Envia um prompt ao Claude e devolve o texto da resposta.
 * @param {string} prompt
 * @param {{maxTokens?: number, system?: string, signal?: AbortSignal}} opts
 */
async function callClaude(prompt, opts = {}) {
  const body = {
    model:      App.model,
    max_tokens: opts.maxTokens ?? 1024,
    messages:   [{ role: 'user', content: prompt }],
  };
  if (opts.system) body.system = opts.system;

  const response = await fetch(API_URL, {
    method:  'POST',
    signal:  opts.signal,
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         App.apiKey,
      'anthropic-version': '2023-06-01',
      // Header obrigatório para chamadas diretas do browser
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json();
      detail = err?.error?.message || '';
    } catch (_) { /* corpo não-JSON */ }

    if (response.status === 401) throw new Error('Chave de API inválida ou sem permissão. Verifique em console.anthropic.com.');
    if (response.status === 429) throw new Error('Limite de requisições atingido. Aguarde um momento e tente novamente.');
    if (response.status === 529) throw new Error('API sobrecarregada no momento. Tente novamente em instantes.');
    throw new Error(`Erro da API (${response.status})${detail ? ': ' + detail : ''}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

/** Chama o Claude e devolve o JSON já interpretado. */
async function callClaudeJSON(prompt, opts = {}) {
  const raw = await callClaude(prompt, opts);
  return parseJSON(raw);
}

/** Extrai JSON de uma resposta que pode vir embrulhada em markdown. */
function parseJSON(raw) {
  const clean = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch (_) { /* tenta recorte pelo primeiro/último delimitador */ }

  const first = clean.search(/[{[]/);
  const last  = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(clean.slice(first, last + 1));
    } catch (_) { /* desiste abaixo */ }
  }

  console.error('[parse error] resposta bruta:', raw);
  throw new Error('Resposta da IA não pôde ser interpretada. Tente novamente.');
}

/**
 * Executa tarefas assíncronas com concorrência limitada.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} worker
 */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}

// ════════════════════════════════════════════════
//  NAVEGAÇÃO ENTRE MODOS
// ════════════════════════════════════════════════
function initTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.mode;
      $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.mode-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.mode === target);
      });
    });
  });
}

// ════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initApiKey();
  initTabs();
});
