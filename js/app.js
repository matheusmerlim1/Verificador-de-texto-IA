/**
 * app.js — Modo "Texto"
 *
 * Detecta probabilidade de autoria por IA em texto corrido e, diferente do
 * modo "Código", permite REESCREVER o texto para reduzir os marcadores
 * de geração automática, com reanálise imediata do resultado.
 *
 * Depende de core.js (App, callClaude, helpers).
 */

'use strict';

// ════════════════════════════════════════════════
//  EXEMPLOS
// ════════════════════════════════════════════════
const EXAMPLES = {
  human: `Cara, tentei usar aquele sistema que você me indicou e não funcionou de jeito nenhum. Fiquei mais de duas horas tentando configurar e nada. Acho que o problema é na parte de autenticação porque o erro aparece logo quando eu boto o endereço da carteira. Já tentei reinstalar tudo e ainda assim aparece o mesmo negócio. Alguém sabe o que pode ser? Cheguei a desconfiar que era problema do meu computador, mas meu colega testou no dele e deu o mesmo pau. Fico irritado com essas coisas porque perco tempo que poderia usar pra outras coisas.`,

  ai: `A implementação de sistemas de gestão de direitos digitais baseados em tecnologia blockchain representa um avanço significativo no contexto da proteção de propriedade intelectual no ambiente digital contemporâneo. Através da utilização de contratos inteligentes, é possível garantir a unicidade e a rastreabilidade dos ativos digitais, estabelecendo um paradigma inovador para a comercialização e distribuição de conteúdo. Esta abordagem oferece vantagens substanciais em relação aos modelos tradicionais de DRM, proporcionando maior transparência, segurança e autonomia aos usuários. Os resultados demonstram que a solução proposta apresenta escalabilidade adequada para múltiplas editoras, mantendo a integridade dos direitos autorais.`,

  academic: `O presente trabalho tem como objetivo propor um modelo de empréstimo digital baseado na tecnologia Blockchain. A metodologia empregada seguiu a abordagem Design Science Research, conforme proposto por Hevner et al. (2004). Os dados foram coletados por meio de testes em ambiente controlado utilizando o simulador Ganache, resultando em tempo médio de validação de 1,2 segundos por transação. Conclui-se que o modelo apresenta viabilidade técnica para o contexto proposto, embora apresente limitações decorrentes da dependência de conectividade de rede para a execução das validações em tempo real.`,

  mixed: `Quando comecei a estudar blockchain achei muito complicado, mas depois fui entendendo melhor. A tecnologia de contratos inteligentes permite que as transações sejam executadas de forma automática e transparente, eliminando a necessidade de intermediários. Isso é muito útil pra revenda de ebooks, por exemplo. O sistema que a gente desenvolveu funciona assim: o arquivo fica criptografado e só abre se a blockchain confirmar que você é o dono. Testamos em rede local e funcionou bem, com latência em torno de 1,2 segundos.`,
};

/** Última análise, usada para comparar antes/depois da reescrita. */
const TextState = {
  lastScore: null,
  original: '',
  forensics: null,
};

// ════════════════════════════════════════════════
//  TEXTAREA — contagem de palavras
// ════════════════════════════════════════════════
function initTextarea() {
  const txtEl = $('txt');
  const wcEl  = $('wc');

  txtEl.addEventListener('input', () => {
    wcEl.textContent = countWords(txtEl.value);
    updateAnalyzeBtn();
  });

  $('btn-clear').addEventListener('click', () => {
    txtEl.value = '';
    wcEl.textContent = '0';
    TextState.lastScore = null;
    TextState.original = '';
    updateAnalyzeBtn();
    resetUI();
  });

  document.addEventListener('apikeychange', updateAnalyzeBtn);
}

function updateAnalyzeBtn() {
  const words = countWords($('txt').value);
  $('btn-analyze').disabled = !(words >= MIN_WORDS && App.keyOk);
}

// ════════════════════════════════════════════════
//  EXEMPLOS
// ════════════════════════════════════════════════
function initExamples() {
  $$('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('txt').value = EXAMPLES[chip.dataset.id] || '';
      $('txt').dispatchEvent(new Event('input'));
    });
  });
}

// ════════════════════════════════════════════════
//  UI
// ════════════════════════════════════════════════
function resetUI() {
  show('empty-state', 'flex');
  hide('loading-state');
  hide('gauge-wrap');
  hide('indicators');
  hide('analysis-box');
  hide('rewrite-box');
  hide('text-actions');
  hide('trace-box');
}

function showLoading(msg = 'ANALISANDO PADRÕES LINGUÍSTICOS...') {
  hide('empty-state');
  show('loading-state', 'flex');
  $('loading-msg').textContent = msg;
  hide('gauge-wrap');
  hide('indicators');
  hide('analysis-box');
  hide('text-actions');
}

function showError(msg) {
  showLoading('');
  $('loading-msg').innerHTML = `<span style="color:var(--accent)">❌ ${escHtml(msg)}</span>`;
}

function showResults(data) {
  hide('loading-state');

  // ── Gauge ──
  show('gauge-wrap', 'block');
  const score   = Math.round(data.score);
  const color   = getColor(score);
  const verdict = getVerdict(score);

  $('gauge-score').textContent   = score + '%';
  $('gauge-score').style.color   = color;
  $('gauge-verdict').textContent = verdict.label;
  $('gauge-verdict').style.color = verdict.color;

  // Comparação com a análise anterior (útil após uma reescrita)
  const delta = $('gauge-delta');
  if (TextState.lastScore !== null && TextState.lastScore !== score) {
    const d = score - TextState.lastScore;
    delta.textContent = `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pontos em relação à análise anterior (${TextState.lastScore}%)`;
    delta.style.color = d < 0 ? 'var(--green)' : 'var(--accent)';
    delta.style.display = 'block';
  } else {
    delta.style.display = 'none';
  }
  TextState.lastScore = score;

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

  requestAnimationFrame(() => {
    indList.querySelectorAll('.ind-mini-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });

  // ── Análise ──
  show('analysis-box', 'block');
  $('analysis-text').textContent = data.analysis || '';

  // ── Sugestões de alteração ──
  const sugg = $('text-suggestions');
  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    sugg.innerHTML =
      '<div class="ind-label">O que alterar para reduzir o percentual</div>' +
      data.suggestions.map(s => `<div class="text-sugg">• ${escHtml(s)}</div>`).join('');
    sugg.style.display = 'block';
  } else {
    sugg.style.display = 'none';
  }

  // ── Ações ──
  show('text-actions', 'flex');
  $('btn-rewrite').disabled = score < 25;
  $('btn-rewrite').title = score < 25
    ? 'O texto já apresenta marcadores humanos — reescrita desnecessária.'
    : 'Gerar versão reescrita com menos marcadores de IA';
}

// ════════════════════════════════════════════════
//  PROMPTS
// ════════════════════════════════════════════════
/** Renderiza o painel de rastros técnicos (determinístico, roda sem API). */
function showTraces(f) {
  const box = $('trace-box');
  if (!f.traces.length && !(f.english && f.english.issues.length)) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';

  const badge = f.conclusive
    ? '<span class="trace-verdict conclusive">RASTRO MATERIAL ENCONTRADO</span>'
    : '<span class="trace-verdict">vestígios, nenhum conclusivo</span>';

  const rows = f.traces.map(t => `
    <div class="trace sev-${escHtml(t.severity)}">
      <div class="trace-top">
        <span class="trace-name">${escHtml(t.name)}</span>
        <span class="trace-count">${t.count}×${t.line ? ' · linha ' + t.line : ''}</span>
      </div>
      <div class="trace-note">${escHtml(t.note)}</div>
    </div>`).join('');

  const eng = f.english && f.english.issues.length ? `
    <div class="trace-eng">
      <div class="ind-label">Padrões em inglês — motor avoid-ai-writing (${f.english.score}/100, ${escHtml(f.english.label)})</div>
      ${f.english.issues.map(i =>
        `<span class="tag" title="${escHtml(i.label)}">${escHtml(i.text || i.label)}</span>`).join(' ')}
    </div>` : '';

  box.innerHTML =
    `<div class="rw-head"><div class="ind-label" style="margin:0">Rastros técnicos</div>${badge}</div>` +
    `<div class="trace-summary">${escHtml(f.summary)}</div>` +
    rows + eng;
}

/** Resumo dos rastros para injetar no prompt, ancorando a análise em fatos. */
function tracesBrief(f) {
  if (!f.traces.length) return 'Varredura local: nenhum rastro tecnico encontrado.';
  const linhas = f.traces.map(t =>
    `- ${t.name}: ${t.count} ocorrencia(s)${t.line ? ` (1a na linha ${t.line})` : ''}`);
  const aviso = f.conclusive
    ? '\nAO MENOS UM DESTES E MATERIAL, NAO ESTATISTICO.'
    : '';
  return 'Varredura local deterministica encontrou:\n' + linhas.join('\n') + aviso;
}

function buildPrompt(text, forensics) {
  return `Você é um especialista em linguística computacional e detecção de texto gerado por IA. Analise o texto abaixo e determine a probabilidade de ter sido escrito por uma IA (como ChatGPT, Claude, Gemini, etc.) versus um humano.

EVIDÊNCIA TÉCNICA JÁ COLETADA (varredura local, determinística):
${tracesBrief(forensics)}
Use isso como âncora factual. Rastro material (caractere invisível, homóglifo, assinatura de ferramenta) vale mais que qualquer impressão estilística.

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
  "analysis": "<parágrafo de 3-5 frases em português explicando os principais sinais que levaram à conclusão>",
  "suggestions": ["<3 a 5 alterações concretas que reduziriam os marcadores de IA neste texto específico, citando trechos>"]
}`;
}

// ════════════════════════════════════════════════
//  ANALISAR
// ════════════════════════════════════════════════
function initAnalyzeButton() {
  $('btn-analyze').addEventListener('click', async () => {
    const text = $('txt').value.trim();
    if (countWords(text) < MIN_WORDS) return;
    if (!App.keyOk) {
      showError('Insira uma chave de API válida antes de analisar.');
      return;
    }

    const btn = $('btn-analyze');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Analisando...';
    hide('rewrite-box');
    showLoading();

    try {
      TextState.original = text;
      // Varredura local primeiro: é instantânea, gratuita e não depende da API.
      const forensics = runForensics(text, { mode: 'text' });
      TextState.forensics = forensics;
      const result = await callClaudeJSON(buildPrompt(text, forensics), { maxTokens: 1500 });
      showResults(result);
      showTraces(forensics);
    } catch (err) {
      showError(err.message);
      console.error('[analyze]', err);
    }

    btn.innerHTML = '🔍 Analisar';
    updateAnalyzeBtn();
  });
}

// ════════════════════════════════════════════════
//  REESCREVER
// ════════════════════════════════════════════════
function initRewriteButton() {
  $('btn-rewrite').addEventListener('click', async () => {
    const text = $('txt').value.trim();
    if (countWords(text) < MIN_WORDS || !App.keyOk) return;

    const btn = $('btn-rewrite');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Reescrevendo...';

    try {
      const tone   = $('rewrite-tone').value;
      const sample = $('voice-sample').value;
      const res = await callClaudeJSON(
        buildHumanizePrompt(text, tone, TextState.forensics, sample),
        { maxTokens: 4000 });

      // Garantia final: nenhum caractere invisivel sobrevive a reescrita,
      // mesmo que o modelo tenha deixado passar.
      const limpo = stripInvisible(res.rewritten || '');

      show('rewrite-box', 'block');
      $('rewrite-text').textContent = limpo;

      // Reexecuta a varredura sobre o resultado, para mostrar o que sobrou.
      const pos = runForensics(limpo, { mode: 'text' });
      $('rewrite-audit').innerHTML = pos.traces.length
        ? `<div class="ind-label">Auditoria da reescrita</div><div class="rw-audit warn">` +
          `Ainda restam ${pos.traces.length} vestigio(s): ` +
          pos.traces.map(t => escHtml(t.name)).join(', ') + '</div>'
        : '<div class="ind-label">Auditoria da reescrita</div>' +
          '<div class="rw-audit ok">Nenhum rastro tecnico restante na versao reescrita.</div>';

      const marked = (res.marked || []).map(m => `<li>${escHtml(m)}</li>`).join('');
      $('rewrite-marked').innerHTML = marked
        ? `<details class="rw-marked"><summary>Padroes marcados (${res.marked.length})</summary>` +
          `<ul class="rw-list">${marked}</ul></details>`
        : '';

      const kept = (res.kept || []).map(k => `<li>${escHtml(k)}</li>`).join('');
      $('rewrite-kept').innerHTML = kept
        ? `<div class="ind-label">Preservado de proposito</div><ul class="rw-list">${kept}</ul>`
        : '';

      const changes = (res.changes || []).map(c => `<li>${escHtml(c)}</li>`).join('');
      $('rewrite-changes').innerHTML = changes
        ? `<div class="ind-label">Mudanças aplicadas</div><ul class="rw-list">${changes}</ul>`
        : '';

      const warns = (res.warnings || []).map(w => `<li>${escHtml(w)}</li>`).join('');
      $('rewrite-warnings').innerHTML = warns
        ? `<div class="ind-label">Pontos que exigem sua revisão</div><ul class="rw-list warn">${warns}</ul>`
        : '';

      $('rewrite-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError(err.message);
      console.error('[rewrite]', err);
    }

    btn.innerHTML = '✍️ Reescrever para reduzir IA';
    btn.disabled = false;
  });

  // Substitui o texto original pela versão reescrita e reanalisa
  $('btn-apply-rewrite').addEventListener('click', () => {
    const rewritten = $('rewrite-text').textContent;
    if (!rewritten) return;
    $('txt').value = rewritten;
    $('txt').dispatchEvent(new Event('input'));
    hide('rewrite-box');
    $('btn-analyze').click();
  });

  $('btn-copy-rewrite').addEventListener('click', async () => {
    const btn = $('btn-copy-rewrite');
    try {
      await navigator.clipboard.writeText($('rewrite-text').textContent);
      btn.textContent = '✓ Copiado';
    } catch (_) {
      btn.textContent = '✗ Falhou';
    }
    setTimeout(() => { btn.textContent = '📋 Copiar'; }, 1600);
  });

  $('btn-restore-original').addEventListener('click', () => {
    if (!TextState.original) return;
    $('txt').value = TextState.original;
    $('txt').dispatchEvent(new Event('input'));
    hide('rewrite-box');
  });
}

// ════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initTextarea();
  initExamples();
  initAnalyzeButton();
  initRewriteButton();
  resetUI();
  updateAnalyzeBtn();
});
