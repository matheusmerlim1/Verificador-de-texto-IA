/**
 * code.js — Modo "Código"
 *
 * Recebe uma pasta de projeto (seletor de diretório ou arrastar-e-soltar),
 * filtra os arquivos relevantes, calcula heurísticas locais e — havendo
 * chave de API — submete cada arquivo ao Claude para estimar o percentual
 * de código gerado por IA.
 *
 * GARANTIA DE SOMENTE LEITURA
 * ───────────────────────────
 * Nenhum arquivo do projeto analisado é alterado, reescrito ou regravado.
 * O conteúdo é lido em memória via FileReader e descartado ao final.
 * A saída é exclusivamente um relatório com sugestões.
 */

'use strict';

const CONCURRENCY   = 3;      // requisições simultâneas à API
const PROMPT_CHARS  = 14000;  // recorte de contexto enviado por arquivo

/** Estado do modo código. */
const CodeState = {
  files: [],        // { path, name, size, lang, file, include, skipReason }
  results: [],      // resultado da última análise
  projectName: '',
  running: false,
  abort: null,
};

// ════════════════════════════════════════════════
//  ENTRADA DE ARQUIVOS
// ════════════════════════════════════════════════
function initCodeIntake() {
  const drop   = $('code-drop');
  const picker = $('folder-input');
  const files  = $('files-input');

  $('btn-pick-folder').addEventListener('click', () => picker.click());
  $('btn-pick-files').addEventListener('click', () => files.click());

  picker.addEventListener('change', e => ingestFileList(e.target.files));
  files.addEventListener('change',  e => ingestFileList(e.target.files));

  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('dragging');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
      drop.classList.remove('dragging');
    })
  );

  drop.addEventListener('drop', async e => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items || []);
    const entries = items
      .map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);

    if (entries.length) {
      const collected = [];
      for (const entry of entries) await walkEntry(entry, '', collected);
      ingestEntries(collected);
    } else {
      ingestFileList(e.dataTransfer.files);
    }
  });

  $('btn-clear-code').addEventListener('click', resetCode);
  $('btn-analyze-code').addEventListener('click', runCodeAnalysis);
  $('sel-all').addEventListener('click',  () => toggleAll(true));
  $('sel-none').addEventListener('click', () => toggleAll(false));

  document.addEventListener('apikeychange', updateCodeButton);
}

/** Percorre recursivamente um FileSystemEntry vindo do drag-and-drop. */
async function walkEntry(entry, prefix, out) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ path, file });
    return;
  }

  if (entry.isDirectory) {
    if (IGNORED_DIRS.includes(entry.name)) return;
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const child of batch) await walkEntry(child, path, out);
    } while (batch.length);
  }
}

function ingestFileList(fileList) {
  const arr = Array.from(fileList || []).map(f => ({
    path: (f.webkitRelativePath || f.name).replace(/\\/g, '/'),
    file: f,
  }));
  ingestEntries(arr);
}

function ingestEntries(entries) {
  if (!entries.length) return;

  // Nome do projeto = pasta-raiz comum
  const first = entries[0].path.split('/');
  CodeState.projectName = first.length > 1 ? first[0] : 'projeto';

  CodeState.files = entries.map(({ path, file }) => {
    const verdict = shouldAnalyze(path, file.size);
    return {
      path,
      name: path.split('/').pop(),
      size: file.size,
      lang: langOf(path),
      file,
      include: verdict.ok,
      skipReason: verdict.reason,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));

  renderFileList();
  updateCodeButton();
}

function toggleAll(state) {
  CodeState.files.forEach(f => {
    if (!f.skipReason) f.include = state;
  });
  renderFileList();
  updateCodeButton();
}

function selectedFiles() {
  return CodeState.files.filter(f => f.include);
}

// ════════════════════════════════════════════════
//  LISTA DE ARQUIVOS
// ════════════════════════════════════════════════
function renderFileList() {
  const wrap = $('file-list');
  const all  = CodeState.files;

  if (!all.length) {
    hide('file-panel');
    return;
  }

  show('file-panel', 'flex');

  const included = all.filter(f => f.include);
  const skipped  = all.filter(f => f.skipReason);
  const bytes    = included.reduce((a, f) => a + f.size, 0);

  $('file-summary').innerHTML =
    `<strong>${CodeState.projectName}</strong> · ${all.length} arquivo(s) lido(s) · ` +
    `<strong>${included.length}</strong> selecionado(s) (${fmtBytes(bytes)}) · ` +
    `${skipped.length} ignorado(s) automaticamente`;

  wrap.innerHTML = '';
  all.forEach((f, idx) => {
    const row = document.createElement('label');
    row.className = 'file-row' + (f.skipReason ? ' skipped' : '');
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" ${f.include ? 'checked' : ''} ${f.skipReason ? 'disabled' : ''} />
      <span class="file-path">${escHtml(f.path)}</span>
      <span class="file-lang">${escHtml(f.lang)}</span>
      <span class="file-size">${f.skipReason ? escHtml(f.skipReason) : fmtBytes(f.size)}</span>`;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      CodeState.files[+cb.dataset.idx].include = cb.checked;
      renderFileList();
      updateCodeButton();
    });
  });
}

function updateCodeButton() {
  const btn = $('btn-analyze-code');
  const n   = selectedFiles().length;
  btn.disabled = n === 0 || CodeState.running;
  btn.textContent = n
    ? `📊 Analisar ${n} arquivo(s)`
    : '📊 Analisar projeto';

  const mode = $('code-mode-note');
  mode.textContent = App.keyOk
    ? 'Análise completa: heurísticas locais + avaliação semântica via Claude.'
    : 'Sem chave de API: será feita apenas a análise heurística local (offline, gratuita, menos precisa).';
  mode.className = 'mode-note ' + (App.keyOk ? 'ok' : 'warn');
}

function resetCode() {
  CodeState.files = [];
  CodeState.results = [];
  CodeState.projectName = '';
  $('folder-input').value = '';
  $('files-input').value  = '';
  hide('file-panel');
  hide('code-progress');
  hide('report');
  show('code-empty', 'flex');
  updateCodeButton();
}

// ════════════════════════════════════════════════
//  PROMPT DE ANÁLISE DE CÓDIGO
// ════════════════════════════════════════════════
function buildCodePrompt(file, content, h, f) {
  const truncated = content.length > PROMPT_CHARS;
  const body = content.slice(0, PROMPT_CHARS);

  return `Você é perito em análise forense de autoria de código. Avalie qual proporção deste arquivo tem características de código gerado por assistente de IA (Copilot, ChatGPT, Claude, Cursor) em vez de escrito manualmente por um desenvolvedor.

ARQUIVO: ${file.path}
LINGUAGEM: ${file.lang}
TAMANHO: ${h.stats.totalLines} linhas (${h.stats.loc} de código)${truncated ? '\nOBSERVAÇÃO: conteúdo truncado; avalie a amostra enviada.' : ''}

EVIDÊNCIA HEURÍSTICA PRÉ-COMPUTADA (análise estática local):
${heuristicsBrief(h)}

RASTROS MATERIAIS ENCONTRADOS NA VARREDURA LOCAL:
${f && f.traces.length
  ? f.traces.map(t => `- [${t.severity}] ${t.name}: ${t.count}x${t.line ? ' (linha ' + t.line + ')' : ''} — ${t.note}`).join('\n')
  : '- nenhum'}
${f && f.conclusive ? 'ATENCAO: ha rastro MATERIAL (assinatura de ferramenta ou caractere invisivel). Isso nao e inferencia estilistica.' : ''}

CÓDIGO:
\`\`\`${extOf(file.path)}
${body}
\`\`\`

Critérios de avaliação:
1. Comentários que narram o óbvio, docstrings padronizadas em toda função, seções decorativas.
2. Regularidade excessiva: mesma estrutura repetida, nenhuma inconsistência de estilo, nenhum atalho.
3. Vocabulário de identificadores genérico e desconectado do domínio do problema.
4. Tratamento de erro cerimonial e defensivo demais para o contexto real.
5. Ausência de rastro de iteração: nenhum TODO, nenhuma gambiarra assumida, nenhum código comentado, nenhuma referência a ticket ou discussão.
6. Presença de conhecimento específico do domínio, decisões idiossincráticas e soluções locais — sinais fortes de autoria humana.

Seja calibrado: código idiomático, bem formatado ou que segue um linter NÃO é, por si só, sinal de IA. Projetos com padrão de equipe e formatação automática são normais. Reserve pontuações acima de 75 para casos com múltiplos sinais convergentes.

Responda APENAS com JSON válido, sem markdown e sem texto fora do JSON:
{
  "score": <inteiro 0-100: percentual estimado do arquivo com características de geração por IA>,
  "confidence": "<alta|media|baixa>",
  "verdict": "<frase curta, máx. 8 palavras>",
  "signals": [
    { "name": "<sinal observado>", "score": <0-100>, "evidence": "<trecho ou padrão concreto encontrado, com nº de linha se possível>" }
  ],
  "hotspots": [
    { "lines": "<ex: 45-78>", "score": <0-100>, "why": "<por que este trecho parece gerado>" }
  ],
  "suggestions": [
    { "action": "<mudança concreta e verificável>", "where": "<arquivo/linhas>", "impact": "<alto|medio|baixo>", "effort": "<baixo|medio|alto>", "rationale": "<que sinal isso elimina>" }
  ],
  "summary": "<3-4 frases em português explicando a conclusão>"
}

Regras para "suggestions": proponha mudanças que tornem o código genuinamente mais autoral e específico do domínio — nomear entidades pelo vocabulário do problema, remover comentários que repetem o código, substituir tratamento genérico de erro por tratamento realmente adequado ao caso, documentar decisões de projeto que só o autor conhece. Máximo 5 sinais, 4 hotspots e 5 sugestões. NÃO reescreva o arquivo; apenas descreva o que mudar.`;
}

// ════════════════════════════════════════════════
//  PIPELINE
// ════════════════════════════════════════════════
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    fr.readAsText(file, 'UTF-8');
  });
}

async function runCodeAnalysis() {
  const files = selectedFiles();
  if (!files.length || CodeState.running) return;

  CodeState.running = true;
  CodeState.abort   = new AbortController();
  updateCodeButton();

  hide('code-empty');
  hide('report');
  show('code-progress', 'flex');
  $('btn-analyze-code').textContent = '⏳ Analisando...';
  $('btn-cancel-code').style.display = 'inline-flex';

  const useAI = App.keyOk;
  const total = files.length;
  let done = 0;

  const bump = label => {
    done++;
    const pct = Math.round((done / total) * 100);
    $('progress-fill').style.width = pct + '%';
    $('progress-count').textContent = `${done}/${total}`;
    $('progress-file').textContent = label;
  };

  const results = await runPool(files, useAI ? CONCURRENCY : total, async file => {
    try {
      const content = await readFileText(file.file);
      const h = analyzeHeuristics(content, file.path);
      // Rastros materiais: assinatura de ferramenta, caractere invisivel,
      // tipografia que editor de codigo nao produz.
      const f = runForensics(content, { mode: 'code', lang: file.lang });

      let ai = null;
      if (useAI) {
        try {
          ai = await callClaudeJSON(buildCodePrompt(file, content, h, f), {
            maxTokens: 2000,
            signal: CodeState.abort.signal,
          });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          ai = { error: err.message };
        }
      }

      bump(file.path);
      return buildFileResult(file, h, ai, f);
    } catch (err) {
      if (err.name === 'AbortError') return null;
      bump(file.path);
      return buildFileResult(file, null, { error: err.message }, null);
    }
  });

  CodeState.results = results.filter(Boolean);
  CodeState.running = false;
  CodeState.abort = null;

  hide('code-progress');
  $('btn-cancel-code').style.display = 'none';
  updateCodeButton();

  if (CodeState.results.length) {
    renderReport(buildProjectReport(CodeState.results));
    initHumanizeButtons();     // os cartões de arquivo acabaram de existir
    initProjectHumanize();
  } else {
    show('code-empty', 'flex');
  }
}

/** Combina heurística e avaliação da IA em um resultado por arquivo. */
function buildFileResult(file, h, ai, f) {
  const aiOk  = ai && !ai.error && typeof ai.score === 'number';
  const hScore = h ? h.score : null;

  // A pontuação final pesa mais a avaliação semântica da IA (70/30),
  // porque a heurística não entende o domínio do problema.
  let score;
  if (aiOk && hScore !== null)      score = Math.round(ai.score * 0.7 + hScore * 0.3);
  else if (aiOk)                    score = Math.round(ai.score);
  else if (hScore !== null)         score = hScore;
  else                              score = 0;

  // Rastro material nao entra na media ponderada: ele a substitui.
  // Um arquivo assinado "Co-Authored-By: Claude" nao e 60% de IA, e certeza.
  if (f && f.conclusive) score = Math.max(score, 95);
  else if (f && f.score > 0) score = Math.min(100, Math.round(score + f.score * 0.15));

  return {
    forensics: f,
    path: file.path,
    name: file.name,
    lang: file.lang,
    size: file.size,
    score,
    heuristicScore: hScore,
    aiScore: aiOk ? Math.round(ai.score) : null,
    confidence: aiOk ? (ai.confidence || 'media') : 'baixa',
    verdict: aiOk ? (ai.verdict || '') : 'somente heurística',
    stats: h ? h.stats : null,
    signals: aiOk && Array.isArray(ai.signals) && ai.signals.length
      ? ai.signals
      : (h ? h.signals.map(s => ({ name: s.name, score: s.score, evidence: s.note })) : []),
    hotspots: aiOk && Array.isArray(ai.hotspots) ? ai.hotspots : [],
    suggestions: aiOk && Array.isArray(ai.suggestions) && ai.suggestions.length
      ? ai.suggestions
      : (h ? fallbackSuggestions(h) : []),
    summary: aiOk ? (ai.summary || '') : '',
    error: ai && ai.error ? ai.error : null,
  };
}

/** Sugestões derivadas só das heurísticas (modo offline ou falha da API). */
function fallbackSuggestions(h) {
  const byName = Object.fromEntries(h.signals.map(s => [s.name, s]));
  const out = [];
  const push = (cond, action, rationale, impact) => {
    if (cond) out.push({ action, where: 'arquivo inteiro', impact, effort: 'baixo', rationale });
  };

  push(byName['Comentários redundantes']?.score > 45,
    'Remover os comentários que apenas reescrevem a linha seguinte; manter só os que explicam o porquê de uma decisão.',
    'Elimina o sinal mais forte de geração automática.', 'alto');

  push(byName['Densidade de comentários']?.score > 60,
    'Reduzir a densidade de comentários para a faixa de 5–12% típica de código autoral, mantendo só os que explicam decisões.',
    `Densidade uniformemente alta é marca registrada de LLM (este arquivo: ${h.stats.commentDensity}%).`, 'alto');

  push(byName['Fraseologia de LLM']?.score > 30,
    'Reescrever docstrings que usam fórmulas como "This function handles...", "Args/Returns", "é importante notar".',
    'Fraseologia padronizada é detectada por qualquer classificador.', 'alto');

  push(byName['Nomes genéricos']?.score > 45,
    'Renomear identificadores genéricos (data, result, temp, handler) para o vocabulário do domínio do projeto.',
    'Nomes ligados ao domínio são difíceis de produzir sem conhecer o problema.', 'alto');

  push(byName['Ausência de marcas de autoria']?.score > 55,
    'Registrar decisões reais em comentários: limitações conhecidas, TODOs verdadeiros, links para a fonte da solução.',
    'Recupera o rastro de iteração que o código não tem.', 'medio');

  push(byName['Tratamento de erro genérico']?.score > 45,
    'Substituir capturas genéricas (except Exception / catch(e)) por tratamento específico dos erros que de fato ocorrem.',
    'Tratamento cerimonial indica código escrito sem contato com a execução real.', 'medio');

  push(byName['Decoração de seções']?.score > 40,
    'Remover banners decorativos e emojis dos comentários de seção.',
    'Decoração uniforme é padrão de saída de assistente.', 'baixo');

  push(byName['Uniformidade estrutural']?.score > 65,
    'Quebrar a regularidade artificial: extrair funções onde faz sentido, aceitar linhas de tamanhos desiguais.',
    'Variação natural de estrutura é característica de escrita humana.', 'baixo');

  return out.slice(0, 5);
}

// ════════════════════════════════════════════════
//  AGREGAÇÃO DO PROJETO
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
//  HUMANIZAR UM ARQUIVO
// ════════════════════════════════════════════════
/**
 * Liga os botões de reescrita dos cartões de arquivo. Chamado depois que o
 * relatório é montado, porque os cartões só existem a partir dali.
 *
 * O conteúdo do arquivo é lido DE NOVO aqui, do handle que ficou em
 * CodeState.files — a análise descarta o texto ao terminar, e manter tudo em
 * memória por causa de um botão que talvez ninguém clique seria desperdício.
 */
function initHumanizeButtons() {
  const raiz = $('rep-details');
  if (!raiz || raiz.dataset.hzLigado) return;
  raiz.dataset.hzLigado = '1';

  raiz.addEventListener('click', async e => {
    const btn = e.target.closest('[data-hz-run]');
    if (btn) return humanizeFile(btn.getAttribute('data-hz-run'), btn);

    const copiar = e.target.closest('[data-hz-copy]');
    if (copiar) {
      const cod = copiar.closest('.hz-result').querySelector('.hz-code').textContent;
      await navigator.clipboard.writeText(cod);
      copiar.textContent = '✓ Copiado';
      setTimeout(() => { copiar.textContent = '📋 Copiar'; }, 1600);
      return;
    }

    const baixar = e.target.closest('[data-hz-download]');
    if (baixar) {
      const caixa = baixar.closest('.hz-result');
      const cod = caixa.querySelector('.hz-code').textContent;
      const nome = baixar.getAttribute('data-hz-download');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([cod], { type: 'text/plain;charset=utf-8' }));
      a.download = nome;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  });
}

/** Pede a reescrita de um arquivo e mostra o resultado no próprio cartão. */
async function humanizeFile(path, btn) {
  const entrada = CodeState.files.find(f => f.path === path);
  const analise = (CodeState.results || []).find(r => r.path === path);
  const saida = document.querySelector(`[data-hz-out="${CSS.escape(path)}"]`);
  if (!entrada || !analise || !saida) return;

  if (!App.keyOk) {
    saida.innerHTML = '<div class="hz-erro">A reescrita usa a API. Configure a chave no topo da página.</div>';
    return;
  }

  const profundidade = document.querySelector(`[data-hz-depth="${CSS.escape(path)}"]`);
  const intensidade = profundidade ? profundidade.value : 'padrao';

  btn.disabled = true;
  const rotulo = btn.innerHTML;
  btn.innerHTML = '<span class="spin"></span> Reescrevendo...';
  saida.innerHTML = '';

  try {
    const conteudo = await readFileText(entrada.file);
    const res = await callClaudeJSON(
      buildHumanizeCodePrompt(entrada, conteudo, analise, { intensidade }),
      { maxTokens: 8000 });

    const codigo = String(res.rewritten || '');
    if (!codigo.trim()) throw new Error('a resposta veio sem o arquivo reescrito');

    // Remede pela heurística local: é a parte que roda aqui, sem depender da API,
    // e mostra se a reescrita de fato mexeu no que era medido.
    const antes = analise.heuristicScore;
    const depois = analyzeHeuristics(codigo, entrada.path);
    const delta = (antes !== null && depois) ? antes - depois.score : null;

    const mudancas = (res.changes || []).map(c =>
      `<li><b>${escHtml(c.what || '')}</b>${c.where ? ` <span class="muted">(${escHtml(c.where)})</span>` : ''}` +
      `${c.why ? `<div class="hz-why">${escHtml(c.why)}</div>` : ''}</li>`).join('');
    const mantido = (res.kept || []).map(k => `<li>${escHtml(k)}</li>`).join('');

    const risco = String(res.risk || 'nenhum').toLowerCase();
    const avisoRisco = (risco === 'medio' || risco === 'alto')
      ? `<div class="hz-erro">Risco declarado de ter mexido em comportamento: <b>${escHtml(risco)}</b>.
         Compare com o original antes de usar.</div>` : '';

    saida.innerHTML = `
      <div class="hz-result">
        ${avisoRisco}
        <div class="hz-deltas">
          <span>heurística local: <b>${antes === null ? '—' : antes + '%'}</b> → <b>${depois.score}%</b></span>
          ${delta !== null ? `<span class="hz-delta ${delta > 0 ? 'ok' : 'flat'}">${delta > 0 ? '−' + delta : '±0'} ponto(s)</span>` : ''}
        </div>
        ${res.note ? `<div class="hz-note">${escHtml(res.note)}</div>` : ''}
        <div class="hz-actions">
          <button class="btn btn-ghost btn-sm" data-hz-copy>📋 Copiar</button>
          <button class="btn btn-ghost btn-sm" data-hz-download="${escHtml(entrada.name)}">⬇️ Baixar cópia</button>
        </div>
        <pre class="hz-code">${escHtml(codigo)}</pre>
        ${mudancas ? `<details class="hz-list"><summary>O que mudou (${(res.changes || []).length})</summary><ul>${mudancas}</ul></details>` : ''}
        ${mantido ? `<details class="hz-list"><summary>O que foi mantido de propósito (${(res.kept || []).length})</summary><ul>${mantido}</ul></details>` : ''}
      </div>`;
  } catch (err) {
    saida.innerHTML = `<div class="hz-erro">Não deu para reescrever: ${escHtml(err.message || String(err))}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = rotulo;
  }
}

// ════════════════════════════════════════════════
//  REESCREVER O PROJETO INTEIRO
// ════════════════════════════════════════════════
/**
 * Reescreve todos os arquivos analisados e, para cada um, roda a análise DE NOVO
 * sobre o resultado. O percentual final é medido no código reescrito, não estimado
 * a partir do que o modelo disse ter mudado.
 *
 * São duas chamadas por arquivo (reescrever, reanalisar). A barra diz o total antes
 * de começar, e o botão de cancelar interrompe entre arquivos.
 */
const PZ = { running: false, abort: null, itens: [] };

function initProjectHumanize() {
  const raiz = $('rep-humanize');
  if (!raiz || raiz.dataset.pzLigado) return;
  raiz.dataset.pzLigado = '1';

  raiz.addEventListener('click', async e => {
    if (e.target.closest('#pz-run'))    return runProjectHumanize();
    if (e.target.closest('#pz-cancel')) { if (PZ.abort) PZ.abort.abort(); return; }

    const baixar = e.target.closest('#pz-zip');
    if (baixar) {
      const zip = buildZip(PZ.itens.filter(i => i.codigo)
        .map(i => ({ path: i.path, text: i.codigo })));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip);
      a.download = `${(CodeState.projectName || 'projeto').replace(/[^\w.-]+/g, '_')}-humanizado.zip`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  });
}

async function runProjectHumanize() {
  if (PZ.running) return;
  const saida = $('pz-out');

  if (!App.keyOk) {
    saida.innerHTML = '<div class="hz-erro">A reescrita usa a API. Configure a chave no topo da página.</div>';
    return;
  }

  const arquivos = (CodeState.results || []).filter(r => !r.error || r.heuristicScore !== null);
  if (!arquivos.length) return;

  const intensidade = ($('pz-depth') || {}).value || 'padrao';
  const reanalisar  = ($('pz-reanalyze') || {}).checked !== false;

  PZ.running = true;
  PZ.abort = new AbortController();
  PZ.itens = [];
  $('pz-run').disabled = true;
  show('pz-cancel', 'inline-flex');
  show('pz-progress', 'block');
  saida.innerHTML = '';

  const passos = arquivos.length * (reanalisar ? 2 : 1);
  let feitos = 0;
  const avanca = txt => {
    feitos++;
    $('pz-bar-fill').style.width = Math.round(feitos / passos * 100) + '%';
    $('pz-status').textContent = txt;
  };

  try {
    for (const analise of arquivos) {
      if (PZ.abort.signal.aborted) break;
      const entrada = CodeState.files.find(f => f.path === analise.path);
      if (!entrada) continue;

      const item = { path: analise.path, name: entrada.name, antes: analise.score,
                     depois: null, codigo: null, erro: null, changes: [], risk: 'nenhum' };
      PZ.itens.push(item);

      try {
        const conteudo = await readFileText(entrada.file);
        avanca(`Reescrevendo ${analise.path}…`);
        const res = await callClaudeJSON(
          buildHumanizeCodePrompt(entrada, conteudo, analise, { intensidade }),
          { maxTokens: 8000, signal: PZ.abort.signal });

        item.codigo  = String(res.rewritten || '');
        item.changes = res.changes || [];
        item.risk    = String(res.risk || 'nenhum').toLowerCase();
        if (!item.codigo.trim()) throw new Error('resposta sem o arquivo reescrito');

        // A medida local sempre existe, mesmo sem reanálise pela API.
        const h = analyzeHeuristics(item.codigo, entrada.path);
        item.heuristicaDepois = h ? h.score : null;

        // A medida local já vale como "depois". A reanálise, quando dá certo, substitui.
        item.depois = item.heuristicaDepois;
        item.medidaDepois = 'heurística';

        if (reanalisar && !PZ.abort.signal.aborted) {
          avanca(`Reanalisando ${analise.path}…`);
          try {
            const f2 = runForensics(item.codigo, { mode: 'code' });
            const ai2 = await callClaudeJSON(
              buildCodePrompt(entrada, item.codigo, h, f2),
              { maxTokens: 2000, signal: PZ.abort.signal });
            item.depois = buildFileResult(entrada, h, ai2, f2).score;
            item.medidaDepois = 'reanalisado';
          } catch (err2) {
            if (err2.name === 'AbortError') throw err2;
            // Falhar a reanálise não apaga a reescrita nem a medida local.
            item.aviso = 'reanálise falhou: ' + (err2.message || String(err2));
          }
        }
      } catch (err) {
        item.erro = err.name === 'AbortError' ? 'cancelado' : (err.message || String(err));
        if (err.name === 'AbortError') break;
      }
    }
  } finally {
    PZ.running = false;
    $('pz-run').disabled = false;
    hide('pz-cancel');
    hide('pz-progress');
    renderProjectHumanizeResult(reanalisar);
  }
}

/** O resumo: percentual do projeto antes e depois, e a tabela por arquivo. */
function renderProjectHumanizeResult(reanalisado) {
  const itens = PZ.itens;
  const saida = $('pz-out');
  if (!itens.length) { saida.innerHTML = ''; return; }

  const feitos = itens.filter(i => i.codigo && i.depois !== null);
  // Mesma ponderação do relatório: arquivo grande pesa mais que arquivo de 10 linhas.
  const peso = p => {
    const f = CodeState.files.find(x => x.path === p);
    return f ? Math.max(f.size, 1) : 1;
  };
  const media = (lista, campo) => {
    const somaPeso = lista.reduce((t, i) => t + peso(i.path), 0);
    return somaPeso ? Math.round(lista.reduce((t, i) => t + i[campo] * peso(i.path), 0) / somaPeso) : 0;
  };
  const antes  = media(feitos, 'antes');
  const depois = media(feitos, 'depois');
  const queda  = antes - depois;

  const linhas = itens.map(i => {
    if (i.erro || i.depois === null) {
      // A mensagem completa fica no aviso acima da tabela: quando a causa é a mesma para
      // todos (chave sem workspace, por exemplo), repeti-la em cada linha vira parede.
      return `<tr>
        <td class="pz-arq">${escHtml(i.path)}</td>
        <td class="num" style="color:${getColor(i.antes)}">${i.antes}%</td>
        <td class="num">—</td>
        <td class="num pz-igual">não reescrito</td>
      </tr>`;
    }
    const d = i.antes - i.depois;
    const comoMedido = i.medidaDepois === 'reanalisado' ? '' : ' <span class="pz-tag">heurística</span>';
    return `<tr>
      <td class="pz-arq">${escHtml(i.path)}${i.aviso ? '<span class="pz-tag">reanálise falhou</span>' : ''}</td>
      <td class="num" style="color:${getColor(i.antes)}">${i.antes}%</td>
      <td class="num" style="color:${getColor(i.depois)}">${i.depois}%${comoMedido}</td>
      <td class="num ${d > 0 ? 'pz-baixou' : 'pz-igual'}">${d > 0 ? '−' + d : (d < 0 ? '+' + (-d) : '±0')}</td>
    </tr>`;
  }).join('');

  // Agrupa as falhas por mensagem: a mesma causa não precisa ser dita várias vezes.
  const falhas = new Map();
  itens.forEach(i => {
    const msg = i.erro || i.aviso;
    if (!msg) return;
    if (!falhas.has(msg)) falhas.set(msg, []);
    falhas.get(msg).push(i.path);
  });
  const blocoFalhas = [...falhas].map(([msg, arquivos]) => `
    <div class="hz-erro">
      <div class="pz-falha-msg">${escHtml(msg)}</div>
      <div class="pz-falha-arqs">${arquivos.length} arquivo(s): ${
        arquivos.slice(0, 8).map(a => `<code>${escHtml(a)}</code>`).join(' ')}${
        arquivos.length > 8 ? ` <span class="muted">+${arquivos.length - 8}</span>` : ''}</div>
    </div>`).join('');

  const risco = itens.filter(i => i.risk === 'medio' || i.risk === 'alto');
  saida.innerHTML = `
    <div class="pz-result">
      <div class="pz-scores">
        <div class="pz-score"><span class="pz-score-lab">antes</span>
          <b style="color:${getColor(antes)}">${antes}%</b></div>
        <div class="pz-arrow">→</div>
        <div class="pz-score"><span class="pz-score-lab">depois${reanalisado ? '' : ' (heurística)'}</span>
          <b style="color:${getColor(depois)}">${depois}%</b></div>
        <div class="pz-queda ${queda > 0 ? 'ok' : 'flat'}">${queda > 0 ? '−' + queda + ' pontos' : '±0'}</div>
      </div>
      <div class="pz-sub">${feitos.length} de ${itens.length} arquivo(s) reescritos${
        (() => {
          const rean = feitos.filter(i => i.medidaDepois === 'reanalisado').length;
          if (!reanalisado) return '. Sem reanálise: o percentual acima é da heurística local';
          if (rean === feitos.length) return ', com o percentual medido de novo sobre o código reescrito';
          return `, ${rean} com o percentual reanalisado e ${feitos.length - rean} só pela heurística local`;
        })()}.</div>
      ${blocoFalhas}
      ${risco.length ? `<div class="hz-erro">${risco.length} arquivo(s) com risco declarado de
        mudança de comportamento: ${risco.map(i => escHtml(i.path)).join(', ')}. Compare com o
        original antes de usar.</div>` : ''}
      <div class="pz-actions">
        <button class="btn btn-primary" id="pz-zip">⬇️ Baixar tudo (.zip)</button>
      </div>
      <div class="pz-table-wrap"><table class="pz-table">
        <thead><tr><th>arquivo</th><th class="num">antes</th><th class="num">depois</th><th class="num">queda</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
      <div class="hz-warn">O .zip traz só os arquivos reescritos, com o caminho original. Nada
        foi gravado no seu projeto — a comparação e os testes são com você.</div>
    </div>`;
}

function buildProjectReport(results) {
  const withLoc = results.map(r => ({ ...r, loc: r.stats?.loc || 1 }));
  const totalLoc = withLoc.reduce((a, r) => a + r.loc, 0);

  // Média ponderada por linhas de código: um arquivo de 500 linhas
  // pesa mais no percentual do projeto que um de 10 linhas.
  const weighted = Math.round(
    withLoc.reduce((a, r) => a + r.score * r.loc, 0) / (totalLoc || 1)
  );
  const simple = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);

  const buckets = { human: 0, mixed: 0, ai: 0 };
  results.forEach(r => {
    if (r.score <= 40) buckets.human++;
    else if (r.score <= 65) buckets.mixed++;
    else buckets.ai++;
  });

  // Sugestões do projeto: agrupa ações repetidas entre arquivos.
  const bag = new Map();
  results.forEach(r => {
    (r.suggestions || []).forEach(s => {
      const key = normalizeSuggestion(s.action);
      const cur = bag.get(key) || { ...s, files: [], count: 0 };
      cur.count++;
      if (!cur.files.includes(r.path)) cur.files.push(r.path);
      bag.set(key, cur);
    });
  });

  const impactRank = { alto: 3, medio: 2, baixo: 1 };
  const global = Array.from(bag.values())
    .sort((a, b) =>
      (b.count - a.count) ||
      ((impactRank[b.impact] || 0) - (impactRank[a.impact] || 0))
    )
    .slice(0, 10);

  return {
    project: CodeState.projectName || 'projeto',
    generatedAt: new Date(),
    model: App.keyOk ? MODELS[App.model] : 'Somente heurística local',
    weighted,
    simple,
    totalLoc,
    buckets,
    files: results.sort((a, b) => b.score - a.score),
    globalSuggestions: global,
  };
}

function normalizeSuggestion(action) {
  return String(action || '')
    .toLowerCase()
    // sem o acento: "genéricos" e "genericos" são a mesma sugestão e têm que cair
    // no mesmo grupo, senão a mesma recomendação aparece duas vezes no relatório
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 5)
    .join(' ');
}

// ════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initCodeIntake();
  $('btn-cancel-code').addEventListener('click', () => {
    if (CodeState.abort) CodeState.abort.abort();
  });
  updateCodeButton();
});
