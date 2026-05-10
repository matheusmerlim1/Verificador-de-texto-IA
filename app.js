/**
 * app.js — Detector de Texto IA
 *
 * Chama a API da Anthropic diretamente do browser.
 * A chave é salva no localStorage do usuário — nunca vai para nenhum servidor externo.
 *
 * Requer o header:  anthropic-dangerous-direct-browser-access: true
 * (obrigatório para chamadas diretas do browser pela Anthropic)
 */

'use strict';

// ════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════
const API_URL     = 'https://api.anthropic.com/v1/messages';
const MODEL       = 'claude-sonnet-4-20250514';
const LS_KEY      = 'dlm_anthropic_key';
const MIN_WORDS   = 20;

// ════════════════════════════════════════════════
//  EXEMPLOS
// ════════════════════════════════════════════════
const EXAMPLES = {
  human: `Cara, tentei usar aquele sistema que você me indicou e não funcionou de jeito nenhum. Fiquei mais de duas horas tentando configurar e nada. Acho que o problema é na parte de autenticação porque o erro aparece logo quando eu boto o endereço da carteira. Já tentei reinstalar tudo e ainda assim aparece o mesmo negócio. Alguém sabe o que pode ser? Cheguei a desconfiar que era problema do meu computador, mas meu colega testou no dele e deu o mesmo pau. Fico irritado com essas coisas porque perco tempo que poderia usar pra outras coisas.`,

  ai: `A implementação de sistemas de gestão de direitos digitais baseados em tecnologia blockchain representa um avanço significativo no contexto da proteção de propriedade intelectual no ambiente digital contemporâneo. Através da utilização de contratos inteligentes, é possível garantir a unicidade e a rastreabilidade dos ativos digitais, estabelecendo um paradigma inovador para a comercialização e distribuição de conteúdo. Esta abordagem oferece vantagens substanciais em relação aos modelos tradicionais de DRM, proporcionando maior transparência, segurança e autonomia aos usuários. Os resultados demonstram que a solução proposta apresenta escalabilidade adequada para múltiplas editoras, mantendo a integridade dos direitos autorais.`,

  academic: `O presente trabalho tem como objetivo propor um modelo de empréstimo digital baseado na tecnologia Blockchain. A metodologia empregada seguiu a abordagem Design Science Research, conforme proposto por Hevner et al. (2004). Os dados foram coletados por meio de testes em ambiente controlado utilizando o simulador Ganache, resultando em tempo médio de validação de 1,2 segundos por transação. Conclui-se que o modelo apresenta viabilidade técnica para o contexto proposto, embora apresente limitações decorrentes da dependência de conectividade de rede para a execução das validações em tempo real.`,

  mixed: `Quando comecei a estudar blockchain achei muito complicado, mas depois fui entendendo melhor. A tecnologia de contratos inteligentes permite que as transações sejam executadas de forma automática e transparente, eliminando a necessidade de intermediários. Isso é muito útil pra revenda de ebooks, por exemplo. O sistema que a gente desenvolveu funciona assim: o arquivo fica criptografado e só abre se a blockchain confirmar que você é o dono. Testamos em rede local e funcionou bem, com latência em torno de 1,2 segundos.`,
};

// ════════════════════════════════════════════════
//  ESTADO
// ════════════════════════════════════════════════
let apiKey = localStorage.getItem(LS_KEY) || '';

// ════════════════════════════════════════════════
//  UTILITÁRIOS DOM
// ════════════════════════════════════════════════
const $ = id => document.getElementById(id);

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

// ════════════════════════════════════════════════
//  API KEY — carregamento e validação
// ════════════════════════════════════════════════
function initApiKey() {
  const input  = $('api-key-input');
  const badge  = $('api-key-badge');
  const btnAna = $('btn-analyze');

  // Preenche do localStorage
  if (apiKey) {
    input.value = apiKey;
    setKeyStatus(apiKey);
  }

  input.addEventListener('input', () => {
    apiKey = input.value.trim();
    localStorage.setItem(LS_KEY, apiKey);
    setKeyStatus(apiKey);
    updateAnalyzeBtn();
  });

  function setKeyStatus(key) {
    const ok = key.startsWith('sk-ant') && key.length > 20;
    badge.className  = 'apikey-badge ' + (key ? (ok ? 'ok' : 'err') : 'idle');
    badge.textContent = key
      ? (ok ? '✅ Chave válida — salva no navegador' : '❌ Formato inválido')
      : 'Aguardando chave';
    input.className  = 'apikey-input ' + (key && ok ? 'valid' : '');
  }
}

// ════════════════════════════════════════════════
//  TEXTAREA — contagem de palavras
// ════════════════════════════════════════════════
function initTextarea() {
  const txtEl = $('txt');
  const wcEl  = $('wc');

  txtEl.addEventListener('input', () => {
    const words = txtEl.value.trim().split(/\s+/).filter(Boolean).length;
    wcEl.textContent = words;
    updateAnalyzeBtn();
  });

  $('btn-clear').addEventListener('click', () => {
    txtEl.value = '';
    wcEl.textContent = '0';
    updateAnalyzeBtn();
    resetUI();
  });
}

function updateAnalyzeBtn() {
  const txt   = $('txt').value.trim();
  const words = txt.split(/\s+/).filter(Boolean).length;
  const keyOk = apiKey.startsWith('sk-ant') && apiKey.length > 20;
  $('btn-analyze').disabled = !(words >= MIN_WORDS && keyOk);
}

// ════════════════════════════════════════════════
//  EXEMPLOS
// ════════════════════════════════════════════════
function initExamples() {
  document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('txt').value = EXAMPLES[chip.dataset.id] || '';
      $('txt').dispatchEvent(new Event('input'));
    });
  });
}

// ════════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════════
function resetUI() {
  show('empty-state',   'flex');
  hide('loading-state');
  hide('gauge-wrap');
  hide('indicators');
  hide('analysis-box');
}

function showLoading(msg = 'ANALISANDO PADRÕES LINGUÍSTICOS...') {
  hide('empty-state');
  show('loading-state', 'flex');
  $('loading-msg').textContent = msg;
  hide('gauge-wrap');
  hide('indicators');
  hide('analysis-box');
}

function showError(msg) {
  showLoading('');
  $('loading-msg').innerHTML = `<span style="color:var(--accent)">❌ ${escHtml(msg)}</span>`;
}

function getColor(score) {
  if (score <= 30) return '#27ae60';
  if (score <= 55) return '#e67e22';
  return '#c0392b';
}

function getVerdict(score) {
  if (score <= 20) return { label: 'PROVAVELMENTE HUMANO',  color: '#27ae60' };
  if (score <= 40) return { label: 'INDICADORES HUMANOS',   color: '#2ecc71' };
  if (score <= 60) return { label: 'INCONCLUSIVO',          color: '#e67e22' };
  if (score <= 80) return { label: 'INDICADORES DE IA',     color: '#e67e22' };
  return                  { label: 'PROVAVELMENTE IA',      color: '#c0392b' };
}

function showResults(data) {
  hide('loading-state');

  // ── Gauge ──
  show('gauge-wrap', 'block');
  const { score } = data;
  const color   = getColor(score);
  const verdict = getVerdict(score);

  $('gauge-score').textContent    = score + '%';
  $('gauge-score').style.color    = color;
  $('gauge-verdict').textContent  = verdict.label;
  $('gauge-verdict').style.color  = verdict.color;

  // Anima a barra depois de um tick para o CSS transition funcionar
  requestAnimationFrame(() => {
    $('gauge-fill').style.width      = score + '%';
    $('gauge-fill').style.background = color;
  });

  // ── Indicadores ──
  show('indicators', 'flex');
  const indList = $('ind-list');
  indList.innerHTML = '';

  (data.indicators || []).forEach(ind => {
    const c  = getColor(ind.score);
    const el = document.createElement('div');
    el.className = 'indicator';
    el.innerHTML = `
      <div class="ind-top">
        <div class="ind-name">${escHtml(ind.name)}</div>
        <div class="ind-badge" style="background:${c}18;color:${c};border:1px solid ${c}44">
          ${ind.score}%
        </div>
      </div>
      <div class="ind-desc">${escHtml(ind.description)}</div>
      <div class="ind-mini-bar">
        <div class="ind-mini-fill" style="width:0%;background:${c}" data-w="${ind.score}"></div>
      </div>`;
    indList.appendChild(el);
  });

  // Anima mini-barras
  requestAnimationFrame(() => {
    indList.querySelectorAll('.ind-mini-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });

  // ── Análise ──
  show('analysis-box', 'block');
  $('analysis-text').textContent = data.analysis || '';
}

// ════════════════════════════════════════════════
//  PROMPT
// ════════════════════════════════════════════════
function buildPrompt(text) {
  return `Você é um especialista em linguística computacional e detecção de texto gerado por IA. Analise o texto abaixo e determine a probabilidade de ter sido escrito por uma IA (como ChatGPT, Claude, Gemini, etc.) versus um humano.

Texto a analisar:
"""
${text.slice(0, 8000)}
"""

Analise estes indicadores específicos:
1. Perplexidade e previsibilidade lexical (vocabulário muito uniforme e "seguro" sugere IA)
2. Variância de comprimento de frases (frases muito uniformes em tamanho sugerem IA)
3. Marcadores de oralidade e informalidade (gírias, contrações, erros leves — sugerem humano)
4. Hedging excessivo e linguagem de disclaimers ("é importante notar", "vale ressaltar" — sugere IA)
5. Expressões de experiência pessoal genuína (anedotas específicas, contexto situado — sugerem humano)

Responda APENAS com um JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "score": <inteiro de 0 a 100, onde 0=certamente humano e 100=certamente IA>,
  "indicators": [
    { "name": "Previsibilidade Lexical",  "score": <0-100>, "description": "<1-2 frases sobre o que foi observado>" },
    { "name": "Uniformidade de Frases",   "score": <0-100>, "description": "<1-2 frases>" },
    { "name": "Marcadores de Oralidade",  "score": <0-100>, "description": "<1-2 frases>" },
    { "name": "Hedging e Disclaimers",    "score": <0-100>, "description": "<1-2 frases>" },
    { "name": "Experiência Pessoal",      "score": <0-100>, "description": "<1-2 frases>" }
  ],
  "analysis": "<parágrafo de 3-5 frases em português explicando os principais sinais que levaram à conclusão>"
}`;
}

// ════════════════════════════════════════════════
//  CHAMADA À API
// ════════════════════════════════════════════════
async function callAPI(text) {
  const response = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     apiKey,
      'anthropic-version': '2023-06-01',
      // Header obrigatório para chamadas diretas do browser
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 1024,
      messages:   [{ role: 'user', content: buildPrompt(text) }],
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json();
      detail = err?.error?.message || '';
    } catch (_) {}

    if (response.status === 401) throw new Error('Chave de API inválida ou sem permissão. Verifique em console.anthropic.com.');
    if (response.status === 429) throw new Error('Limite de requisições atingido. Aguarde um momento e tente novamente.');
    throw new Error(`Erro da API (${response.status})${detail ? ': ' + detail : ''}`);
  }

  const data  = await response.json();
  const raw   = data.content?.[0]?.text?.trim() ?? '';
  const clean = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error('[parse error] resposta bruta:', raw);
    throw new Error('Resposta da IA não pôde ser interpretada. Tente novamente.');
  }
}

// ════════════════════════════════════════════════
//  BOTÃO ANALISAR
// ════════════════════════════════════════════════
function initAnalyzeButton() {
  $('btn-analyze').addEventListener('click', async () => {
    const text = $('txt').value.trim();
    if (!text || text.split(/\s+/).filter(Boolean).length < MIN_WORDS) return;
    if (!apiKey.startsWith('sk-ant')) {
      showError('Insira uma chave de API válida antes de analisar.');
      return;
    }

    const btn = $('btn-analyze');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Analisando...';
    showLoading();

    try {
      const result = await callAPI(text);
      showResults(result);
    } catch (err) {
      showError(err.message);
      console.error('[analyze]', err);
    }

    btn.disabled = false;
    btn.innerHTML = '🔍 Analisar';
    updateAnalyzeBtn();
  });
}

// ════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initApiKey();
  initTextarea();
  initExamples();
  initAnalyzeButton();
  resetUI();
  updateAnalyzeBtn();
});
