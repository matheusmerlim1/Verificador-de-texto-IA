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
    .replace(/[^a-zà-ú\s]/g, '')
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
