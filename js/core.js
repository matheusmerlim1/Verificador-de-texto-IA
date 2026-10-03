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
const LS_WS     = 'dlm_workspace_id';   // chave de organização precisa dizer o workspace
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
  // Só é necessário quando a chave é da organização e não de um workspace.
  workspaceId: CFG.workspaceId || localStorage.getItem(LS_WS) || '',
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
/**
 * Traz o campo do workspace para a frente quando a API reclama de escopo. A mensagem de
 * erro manda preencher um campo; esta função garante que o campo esteja visível, em foco
 * e marcado, em vez de deixar a pessoa procurando.
 */
function pedirWorkspace() {
  const ws = document.getElementById('workspace-input');
  if (!ws) return;
  const bar = ws.closest('.apikey-bar');
  if (bar) bar.classList.add('precisa-workspace');
  ws.classList.add('pedindo');
  // Marcar o campo é tudo o que se faz aqui. A versão anterior também rolava a página até
  // ele e tomava o foco — a cada chamada que falhava. Com 75 arquivos falhando pela mesma
  // causa, eram 75 saltos: a pessoa tentava ler o relatório e a página puxava de volta
  // para o topo. Quem está lendo manda na rolagem, não o erro.
}

/**
 * Grava o workspace vindo de qualquer lugar da tela e mantém os campos em sincronia.
 * Existe porque agora há dois lugares para preencher: a barra do topo e o formulário que
 * aparece junto do próprio erro.
 */
function definirWorkspace(valor) {
  App.workspaceId = String(valor || '').trim();
  try { localStorage.setItem(LS_WS, App.workspaceId); } catch (_) { /* modo privado */ }
  const ws = document.getElementById('workspace-input');
  if (ws) {
    ws.value = App.workspaceId;
    if (App.workspaceId) ws.classList.remove('pedindo');
  }
  return App.workspaceId;
}

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
      ligarWorkspace();
      return;
    }

    bar.classList.add('embedded');
    // O campo do workspace tem que sobreviver à troca do innerHTML. Chave de
    // organização só funciona com ele preenchido, e a mensagem de erro da API manda
    // preencher justamente este campo: apagá-lo aqui deixava a pessoa num beco —
    // o erro pedia um campo que não existia mais na tela.
    const ws = $('workspace-input');
    if (EMBEDDED_KEY) {
      bar.innerHTML =
        `<span class="apikey-label">🔑 ${escHtml(CFG.ownerLabel || 'Chave cadastrada')}</span>` +
        `<span class="apikey-badge ok">✅ Pronto para analisar</span>` +
        `<span class="apikey-hint">O consumo é faturado na conta do responsável por esta cópia.</span>`;
    } else {
      // Build privado sem chave: falta um passo de instalação, não é erro do usuário.
      bar.classList.add('unconfigured');
      bar.innerHTML =
        `<span class="apikey-label">🔑 Chave não configurada</span>` +
        `<span class="apikey-badge err">⚠️ Falta preencher config.js</span>` +
        `<span class="apikey-hint">Abra <code>config.js</code>, cole a chave em <code>apiKey</code> e recarregue a página (Ctrl+F5).</span>`;
    }
    // Recria o seletor de modelo e o campo do workspace, tirados junto com o innerHTML.
    bar.appendChild(sel);
    if (ws) bar.appendChild(ws);
    ligarWorkspace();
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

  ligarWorkspace();

  /**
   * Workspace: só faz falta com chave de organização, então fica discreto e opcional.
   * Roda em todo caminho — com chave digitada ou vinda do config.js. Sem isso, uma
   * chave de organização não tem como ser escopada e toda chamada volta 400.
   */
  function ligarWorkspace() {
    const ws = $('workspace-input');
    if (!ws || ws.dataset.ligado) return;
    ws.dataset.ligado = '1';
    ws.value = App.workspaceId;
    ws.addEventListener('input', () => {
      App.workspaceId = ws.value.trim();
      localStorage.setItem(LS_WS, App.workspaceId);
    });
  }

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
// ════════════════════════════════════════════════
//  DIAGNÓSTICO DAS CHAMADAS
// ════════════════════════════════════════════════
/**
 * Guarda as últimas chamadas à API para que uma falha possa ser investigada em vez de
 * adivinhada. Sem isto, tudo o que sobrava de um erro era uma frase — não dava para saber
 * qual chave foi usada, se o cabeçalho do workspace foi junto, nem o request-id que o
 * suporte pede.
 *
 * A chave nunca entra aqui inteira: só o prefixo, os quatro últimos caracteres e o
 * tamanho. Dá para saber QUAL chave é sem expor nenhuma.
 */
/**
 * Por que alguns cabeçalhos aparecem vazios no diagnóstico.
 *
 * A página roda em outra origem que a API. Numa chamada assim, o navegador só entrega ao
 * JavaScript os cabeçalhos da lista segura — os demais chegam na resposta, mas ficam
 * invisíveis para o código, a não ser que o servidor os libere um a um. Não é defeito da
 * página nem da chave; escrever "(sem)" fazia parecer que era.
 */
const SEM_CABECALHO = '(o navegador não deixa a página ler este cabeçalho)';

const DIAG = [];
const DIAG_MAX = 50;

/** Identifica a chave sem revelá-la. */
function marcaDaChave(chave) {
  if (!chave) return '(vazia)';
  const limpa = String(chave).trim();
  return limpa.slice(0, 7) + '…' + limpa.slice(-4) + ' (' + limpa.length + ' caracteres)';
}

function registrarDiag(entrada) {
  DIAG.push({ quando: new Date().toISOString(), ...entrada });
  if (DIAG.length > DIAG_MAX) DIAG.shift();
}

/**
 * O relatório de diagnóstico, pronto para copiar.
 *
 * Abre com o veredito — o que está falhando e o que resolve — porque quem lê isto está
 * travado e precisa da conclusão, não de 50 linhas para interpretar. Depois vêm o estado
 * da página, o resumo por causa e, por último, o detalhe das últimas chamadas.
 */
function diagnosticoTexto() {
  const linha = '─'.repeat(70);

  // ── o que a página sabe sobre si mesma ──
  const versao = (document.querySelector('link[href*="style.css"]') || {}).href || '';
  const estado = [
    'chave: ' + marcaDaChave(App.apiKey),
    'a chave veio de: ' + (App.embedded ? 'config.js (cópia com chave cadastrada)'
                                        : 'campo na tela / navegador'),
    'campo Workspace: ' + (App.workspaceId || '(VAZIO)'),
    'workspace que a API respondeu: ' + (App.workspaceDaResposta || SEM_CABECALHO),
    'modelo: ' + App.model,
    'endereço: ' + API_URL,
    'versão dos arquivos: ' + ((versao.match(/\?v=([0-9a-z]+)/) || [])[1] || '(sem marca)'),
    'arquivos carregados: ' + (typeof CodeState !== 'undefined' ? CodeState.files.length : 0)
      + ', analisados: ' + (typeof CodeState !== 'undefined' ? CodeState.results.length : 0),
    'navegador: ' + navigator.userAgent,
  ].join('\n');

  if (!DIAG.length) {
    return 'DIAGNÓSTICO — Verificador de texto IA\n' + linha
      + '\nNenhuma chamada à API foi feita nesta sessão.\n\n' + estado;
  }

  // ── agrupa por causa: 50 linhas iguais não ajudam ninguém ──
  const porCausa = new Map();
  DIAG.forEach(d => {
    const chave = d.status + ' | ' + (d.detalhe || d.erro || '');
    if (!porCausa.has(chave)) porCausa.set(chave, {
      status: d.status, texto: d.detalhe || d.erro || '', n: 0, etapas: new Set() });
    const g = porCausa.get(chave);
    g.n++;
    g.etapas.add(d.etapa || '?');
  });

  const falhas = [...porCausa.values()].filter(g => g.status !== 200);
  const sucessos = DIAG.filter(d => d.status === 200).length;

  // ── o veredito: a conclusão primeiro ──
  const vereditos = [];
  if (!falhas.length) {
    vereditos.push('Nenhuma chamada falhou. Se algo não apareceu na tela, o problema não '
      + 'está na API.');
  } else {
    falhas.forEach(g => {
      const onde = [...g.etapas].join(', ');
      if (/not scoped to a workspace|anthropic-workspace-id/i.test(g.texto)) {
        vereditos.push('ONDE: ' + onde + ' (' + g.n + ' chamada[s]).'
          + '\nO QUÊ: a chave não está vinculada a nenhum workspace, e a API precisa saber '
          + 'onde gastar.'
          + '\nESTADO: campo Workspace está ' + (App.workspaceId ? 'preenchido com "'
              + App.workspaceId + '" — então o valor está errado, ou a conta não tem acesso '
              + 'a esse workspace'
            : 'VAZIO')
          + '.\nRESOLVE: criar uma chave nova já vinculada a um workspace em '
          + 'console.anthropic.com → Settings → API keys → Create Key, escolhendo um '
          + 'workspace em vez de "All workspaces". É a saída definitiva: a chave resolve '
          + 'sozinha e nenhum campo precisa ser preenchido. A alternativa é descobrir o ID '
          + 'do workspace e informá-lo no campo — mas o Workspace Padrão não aparece em '
          + 'listagem nenhuma, por desenho da API.');
      } else if (/spend limit|usage limit|credit balance|billing/i.test(g.texto)) {
        vereditos.push('ONDE: ' + onde + ' (' + g.n + ' chamada[s]).'
          + '\nO QUÊ: limite de gasto atingido. Não é problema de configuração da página.'
          + '\nRESOLVE: console.anthropic.com → Settings → Limits.');
      } else if (g.status === 401) {
        vereditos.push('ONDE: ' + onde + ' (' + g.n + ' chamada[s]).'
          + '\nO QUÊ: a chave foi recusada — inválida, revogada ou expirada.'
          + '\nRESOLVE: gerar uma chave nova em console.anthropic.com.');
      } else if (g.status === 'rede') {
        vereditos.push('ONDE: ' + onde + ' (' + g.n + ' tentativa[s]).'
          + '\nO QUÊ: a requisição não chegou a receber resposta — rede, CORS ou '
          + 'cancelamento. Detalhe: ' + g.texto
          + '\nRESOLVE: conferir a conexão; se for CORS, a página precisa ser aberta do '
          + 'disco ou de um servidor local, não de dentro de outra página.');
      } else if (g.status === 'resposta ilegível') {
        vereditos.push('ONDE: ' + onde + ' (' + g.n + ' chamada[s]).'
          + '\nO QUÊ: a API respondeu, mas fora do formato que a página espera. A chamada '
          + 'foi cobrada. ' + g.texto
          + '\nRESOLVE: tentar de novo; se repetir, é o modelo devolvendo texto em vez de '
          + 'JSON — vale reduzir o tamanho do arquivo analisado.');
      } else {
        vereditos.push('ONDE: ' + onde + ' (' + g.n + ' chamada[s]).'
          + '\nO QUÊ: HTTP ' + g.status + ' — ' + (g.texto || 'a API não explicou')
          + '\nRESOLVE: a mensagem acima é da própria API; ela diz o que falta.');
      }
    });
  }

  // ── resumo por causa ──
  const resumo = [...porCausa.values()].map(g =>
    '  ' + String(g.n).padStart(3) + '× ' + (g.status === 200 ? 'OK' : g.status)
    + '  [' + [...g.etapas].join(', ') + ']'
    + (g.texto ? '\n        ' + g.texto.slice(0, 160) : '')).join('\n');

  // ── as últimas chamadas, em detalhe ──
  const ultimas = DIAG.slice(-8).map((d, i) => [
    '[' + (DIAG.length - Math.min(8, DIAG.length) + i + 1) + '] ' + d.quando,
    '    etapa: ' + (d.etapa || '?') + (d.alvo ? ' — ' + d.alvo : ''),
    '    situação: ' + (typeof d.status === 'number' ? 'HTTP ' + d.status
      : d.status === 'rede' ? 'não chegou a responder (rede, CORS ou cancelamento)'
      : d.status),
    '    levou: ' + d.ms + ' ms',
    '    cabeçalho anthropic-workspace-id enviado: ' + (d.mandouWorkspace || 'não'),
    '    request-id: ' + (d.requestId || SEM_CABECALHO),
    d.detalhe ? '    a API respondeu: ' + d.detalhe : '',
    d.erro ? '    falha: ' + d.erro : ''
  ].filter(Boolean).join('\n')).join('\n\n');

  return [
    'DIAGNÓSTICO — Verificador de texto IA',
    'gerado em: ' + new Date().toISOString(),
    linha,
    'VEREDITO',
    linha,
    vereditos.join('\n\n'),
    '',
    linha,
    'ESTADO DA PÁGINA',
    linha,
    estado,
    '',
    linha,
    'RESUMO DAS ' + DIAG.length + ' CHAMADAS (' + sucessos + ' com sucesso)',
    linha,
    resumo,
    '',
    linha,
    'ÚLTIMAS CHAMADAS, EM DETALHE',
    linha,
    ultimas,
  ].join('\n');
}



const WORKSPACES_URL = 'https://api.anthropic.com/v1/organizations/workspaces';

/**
 * Lista os workspaces da organização usando a chave que já está na página.
 *
 * Funciona porque os endpoints de administração aceitam uma chave pessoal ou de conta de
 * serviço que não esteja limitada a um workspace — que é exatamente a chave que cai no
 * erro de escopo. Quem precisa do ID é quem pode buscá-lo.
 *
 * O Workspace Padrão não aparece nesta lista: é assim que a API funciona, e o aviso na
 * tela diz isso para ninguém achar que sumiu algo.
 */
async function listarWorkspaces() {
  const comecou = Date.now();
  let response;
  try {
    response = await fetch(WORKSPACES_URL + '?limit=100', {
      headers: {
        'x-api-key': App.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
  } catch (erroDeRede) {
    registrarDiag({ status: 'rede', ms: Date.now() - comecou, mandouWorkspace: 'n/a',
      erro: 'listar workspaces — ' + erroDeRede.name + ': ' + erroDeRede.message });
    // "Failed to fetch" não explica nada a quem está só tentando usar a ferramenta. O
    // motivo quase sempre é o navegador barrando a chamada por CORS: a liberação de
    // chamada direta vale para a API de mensagens, e o endereço de administração pode
    // não aceitá-la. Nesse caso, a saída é o campo manual logo acima.
    const err = new Error('O navegador barrou a busca (' + erroDeRede.message + '). O '
      + 'endereço que lista os workspaces pode não aceitar chamada direta de página. '
      + 'Pegue o ID no Console e cole no campo acima: console.anthropic.com → Settings → '
      + 'Workspaces → clique no workspace; o ID aparece no endereço da página, começando '
      + 'com wrkspc_.');
    err.causa = 'listar workspaces barrado pelo navegador';
    throw err;
  }

  const requestId = response.headers?.get('request-id') || '';
  let detail = '';
  let corpo = null;
  try { corpo = await response.json(); } catch (_) { /* corpo não-JSON */ }
  if (corpo?.error?.message) detail = corpo.error.message;

  registrarDiag({ status: response.status, ms: Date.now() - comecou,
    mandouWorkspace: 'n/a (listando workspaces)', requestId,
    workspaceResposta: response.headers?.get('anthropic-workspace-id') || '',
    detalhe: detail || 'listar workspaces: ' + (corpo?.data?.length ?? 0) + ' encontrado(s)' });

  if (!response.ok) {
    // 403 aqui é o caso comum, não uma exceção: listar workspaces exige permissão de
    // administração, que uma chave de uso normal não tem. Dizer só "não deu" deixaria a
    // pessoa sem o próximo passo — e o próximo passo existe.
    const dica = response.status === 403 || response.status === 401
      ? 'Esta chave não tem permissão para listar workspaces — é o normal para uma chave '
        + 'de uso comum. Então o caminho é outro: crie uma chave nova já vinculada a um '
        + 'workspace em console.anthropic.com → Settings → API keys → Create Key, '
        + 'escolhendo um workspace em vez de "All workspaces". Ela dispensa este campo.'
      : 'Não deu para listar os workspaces com esta chave.';
    throw montarErro(dica, detail, requestId);
  }
  return (corpo?.data || []).filter(w => !w.archived_at);
}

/**
 * Monta a mensagem de erro sem esconder o que a API disse.
 *
 * A versão anterior trocava o texto da API por um palpite meu. Quando o palpite errava — e
 * errava, porque mais de uma causa de 400 fala em workspace — a pessoa ficava sem nenhuma
 * pista do problema real, seguindo uma instrução que nunca ia funcionar. Agora a dica é
 * acréscimo, nunca substituição, e o request-id vai junto para dar em suporte.
 */
function montarErro(dica, detalhe, requestId) {
  const partes = [dica];
  if (detalhe) partes.push('A API respondeu: "' + detalhe + '"');
  if (requestId) partes.push('(request-id: ' + requestId + ')');
  const err = new Error(partes.join(' '));
  // A causa, sem o request-id. O identificador muda a cada chamada, então usá-lo para
  // agrupar transformaria uma falha repetida em 72 avisos diferentes na tela.
  err.causa = dica + (detalhe ? ' | ' + detalhe : '');
  err.detalhe = detalhe;
  err.requestId = requestId;
  return err;
}

async function callClaude(prompt, opts = {}) {
  const body = {
    model:      App.model,
    max_tokens: opts.maxTokens ?? 1024,
    messages:   [{ role: 'user', content: prompt }],
  };
  if (opts.system) body.system = opts.system;

  const comecou = Date.now();
  let response;
  try {
    response = await fetch(API_URL, {
    method:  'POST',
    signal:  opts.signal,
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         App.apiKey,
      'anthropic-version': '2023-06-01',
      // Header obrigatório para chamadas diretas do browser
      'anthropic-dangerous-direct-browser-access': 'true',
      // Chave de organização não sabe sozinha em que workspace gastar: quando o ID está
      // preenchido, ele vai junto. Chave já vinculada a um workspace ignora o header.
      ...(App.workspaceId ? { 'anthropic-workspace-id': App.workspaceId } : {}),
    },
    body: JSON.stringify(body),
    });
  } catch (erroDeRede) {
    // Falha antes de haver resposta: CORS, rede caída, chamada cancelada.
    registrarDiag({ status: 'rede', ms: Date.now() - comecou,
      etapa: opts.etapa || 'chamada à API', alvo: opts.alvo || '',
      mandouWorkspace: App.workspaceId ? 'sim (' + App.workspaceId + ')' : 'não',
      erro: erroDeRede.name + ': ' + erroDeRede.message });
    throw erroDeRede;
  }

  // Em que workspace a chave caiu. A API devolve isso em toda resposta autenticada, e é
  // o jeito documentado de descobrir onde o consumo está sendo contado.
  // O ?. não é decoração: se ler cabeçalho falhasse, a exceção viria daqui e esconderia
  // o erro de verdade da API — exatamente o que este bloco existe para evitar.
  App.workspaceDaResposta = response.headers?.get('anthropic-workspace-id') || '';
  const requestId = response.headers?.get('request-id') || '';
  const anotar = detalhe => registrarDiag({
    status: response.status, ms: Date.now() - comecou,
    etapa: opts.etapa || 'chamada à API', alvo: opts.alvo || '',
    mandouWorkspace: App.workspaceId ? 'sim (' + App.workspaceId + ')' : 'não',
    requestId, workspaceResposta: App.workspaceDaResposta, detalhe });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json();
      detail = err?.error?.message || '';
    } catch (_) { /* corpo não-JSON */ }
    anotar(detail);

    if (response.status === 401) {
      throw (montarErro('Chave de API inválida, revogada ou sem permissão. '
        + 'Confira em console.anthropic.com.', detail, requestId));
    }

    if (response.status === 400) {
      // Duas causas diferentes de 400 falam em workspace, e confundi-las foi o que fez
      // este erro se repetir: quem bateu no limite de gasto lia "preencha o campo
      // Workspace", preenchia, e continuava no mesmo lugar.
      if (/spend limit|usage limit|limite de gasto|credit balance|billing/i.test(detail)) {
        throw (montarErro('Limite de gasto atingido na organização ou no workspace. '
          + 'Isto não se resolve na página: ajuste o limite em console.anthropic.com → '
          + 'Settings → Limits (ou Workspaces → o workspace → Spend limits).',
          detail, requestId));
      }
      if (/workspace/i.test(detail)) {
        // Vale só para chave de vários workspaces: ela escolhe o workspace a cada
        // requisição, pelo cabeçalho. Chave criada dentro de um workspace já vai
        // sozinha, e para ela preencher o campo não muda nada.
        pedirWorkspace();
        const errWs = montarErro('Esta chave não está vinculada a nenhum workspace, e a '
          + 'API precisa saber onde gastar. A saída mais simples é criar uma chave nova já '
          + 'vinculada a um workspace: console.anthropic.com → Settings → API keys → Create '
          + 'Key, escolhendo um workspace em vez de "All workspaces". Uma chave assim '
          + 'resolve sozinha e dispensa qualquer campo aqui. Se preferir continuar com esta '
          + 'chave, informe abaixo o ID do workspace (começa com wrkspc_).', detail, requestId);
        errWs.precisaWorkspace = true;
        throw errWs;
      }
      throw (montarErro('A API recusou a requisição.', detail, requestId));
    }

    if (response.status === 403) {
      throw (montarErro('A chave não tem permissão para este recurso. Confira o '
        + 'acesso da sua conta ao workspace em console.anthropic.com.', detail, requestId));
    }
    if (response.status === 429) {
      throw (montarErro('Limite de requisições atingido. Aguarde um momento e '
        + 'tente de novo.', detail, requestId));
    }
    if (response.status === 529) {
      throw (montarErro('API sobrecarregada no momento. Tente de novo em instantes.',
        detail, requestId));
    }
    throw (montarErro(`Erro da API (${response.status}).`, detail, requestId));
  }

  anotar('');
  const data = await response.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

/** Chama o Claude e devolve o JSON já interpretado. */
async function callClaudeJSON(prompt, opts = {}) {
  const raw = await callClaude(prompt, opts);
  try {
    return parseJSON(raw);
  } catch (err) {
    // Separar "a API recusou" de "a API respondeu algo que não dá para ler" importa: são
    // problemas diferentes e, antes, os dois chegavam na tela com a mesma cara.
    registrarDiag({ status: 'resposta ilegível', ms: 0,
      etapa: opts.etapa || 'chamada à API', alvo: opts.alvo || '',
      mandouWorkspace: App.workspaceId ? 'sim (' + App.workspaceId + ')' : 'não',
      erro: 'a resposta veio fora do formato esperado',
      detalhe: 'primeiros 200 caracteres: ' + String(raw).slice(0, 200) });
    err.causa = 'resposta da API ilegível na etapa: ' + (opts.etapa || '?');
    throw err;
  }
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
