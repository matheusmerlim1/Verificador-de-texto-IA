/**
 * heuristics.js — Análise estática local de código
 *
 * Calcula sinais objetivos de "cheiro de IA" sem enviar nada para a rede.
 * Serve para dois propósitos:
 *   1. Modo local (sem chave de API) — pontuação puramente heurística.
 *   2. Evidência pré-computada injetada no prompt do Claude, o que reduz
 *      alucinação e torna a pontuação da IA mais estável.
 *
 * IMPORTANTE: este módulo apenas LÊ o código. Nada é reescrito.
 */

'use strict';

// ════════════════════════════════════════════════
//  MAPA DE LINGUAGENS
// ════════════════════════════════════════════════
const LANGS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript (JSX)',
  ts: 'TypeScript', tsx: 'TypeScript (TSX)',
  py: 'Python', rb: 'Ruby', php: 'PHP', go: 'Go', rs: 'Rust',
  java: 'Java', kt: 'Kotlin', swift: 'Swift', scala: 'Scala',
  c: 'C', h: 'C/C++ header', cpp: 'C++', cc: 'C++', hpp: 'C++ header',
  cs: 'C#', sql: 'SQL', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell',
  html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS', vue: 'Vue', svelte: 'Svelte',
  sol: 'Solidity', r: 'R', m: 'MATLAB/Obj-C', dart: 'Dart', lua: 'Lua',
  json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML',
  md: 'Markdown', txt: 'Texto', ipynb: 'Jupyter Notebook',
};

/** Extensões que não valem análise de autoria (dados/config puros). */
const LOW_VALUE_EXT = new Set(['json', 'lock', 'xml', 'toml', 'csv', 'svg', 'txt']);

/** Pastas ignoradas por padrão. */
const IGNORED_DIRS = [
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target',
  'vendor', 'venv', '.venv', 'env', '__pycache__', '.next', '.nuxt', '.cache',
  'coverage', 'bin', 'obj', '.idea', '.vscode', 'migrations', 'bower_components',
  '.gradle', 'Pods', 'DerivedData', 'site-packages', '.pytest_cache', '.mypy_cache',
];

/** Arquivos ignorados (gerados, minificados, travas de dependência). */
const IGNORED_FILES = [
  /\.min\.(js|css)$/i, /-lock\.json$/i, /\.lock$/i, /\.map$/i,
  /^yarn\.lock$/i, /^Gemfile\.lock$/i, /^poetry\.lock$/i, /^composer\.lock$/i,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|exe|dll|so|dylib|woff2?|ttf|eot|mp4|mp3)$/i,
];

const MAX_FILE_BYTES = 400 * 1024;

function extOf(path) {
  const base = path.split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function langOf(path) {
  return LANGS[extOf(path)] || 'Desconhecido';
}

/** Decide se um caminho entra na análise. Devolve {ok, reason}. */
function shouldAnalyze(path, size) {
  const parts = path.split('/');
  const name  = parts[parts.length - 1];

  const dirHit = parts.slice(0, -1).find(p => IGNORED_DIRS.includes(p));
  if (dirHit)                            return { ok: false, reason: `pasta ignorada (${dirHit})` };
  if (name.startsWith('.'))              return { ok: false, reason: 'arquivo oculto' };
  if (IGNORED_FILES.some(r => r.test(name))) return { ok: false, reason: 'gerado/binário/minificado' };
  if (size > MAX_FILE_BYTES)             return { ok: false, reason: `grande demais (${fmtBytes(size)})` };
  if (size === 0)                        return { ok: false, reason: 'vazio' };
  if (!LANGS[extOf(path)])               return { ok: false, reason: 'extensão não suportada' };
  if (LOW_VALUE_EXT.has(extOf(path)))    return { ok: false, reason: 'dado/config, não é autoria de código' };

  return { ok: true, reason: '' };
}

// ════════════════════════════════════════════════
//  TOKENIZAÇÃO SIMPLES DE COMENTÁRIOS
// ════════════════════════════════════════════════
const LINE_COMMENT = {
  py: '#', rb: '#', sh: '#', bash: '#', ps1: '#', r: '#', yml: '#', yaml: '#', toml: '#',
};

function commentPrefix(ext) {
  return LINE_COMMENT[ext] || '//';
}

/** Separa linhas em comentário / código / vazio. */
function classifyLines(lines, ext) {
  const pfx = commentPrefix(ext);
  const out = { comment: [], code: [], blank: 0 };
  let inBlock = false;

  lines.forEach((raw, i) => {
    const line = raw.trim();

    if (!line) { out.blank++; return; }

    if (inBlock) {
      out.comment.push({ i, text: line });
      if (line.includes('*/') || line.includes('"""') || line.includes("'''")) inBlock = false;
      return;
    }

    const opensBlock =
      (line.startsWith('/*') && !line.includes('*/')) ||
      ((line.startsWith('"""') || line.startsWith("'''")) && line.length < 4);

    if (opensBlock) {
      inBlock = true;
      out.comment.push({ i, text: line });
      return;
    }

    if (line.startsWith(pfx) || line.startsWith('/*') || line.startsWith('*') ||
        line.startsWith('"""') || line.startsWith("'''") || line.startsWith('<!--')) {
      out.comment.push({ i, text: line });
      return;
    }

    out.code.push({ i, text: line, raw });
  });

  return out;
}

function stdev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

// ════════════════════════════════════════════════
//  SINAIS
//  Cada sinal devolve { score: 0-100, weight, note }
//  score alto = mais cara de IA
// ════════════════════════════════════════════════

/** Frases de docstring/comentário típicas de LLM. */
const LLM_PHRASES = [
  /\bthis (?:function|method|class|module|script)\s+(?:is used to|will|does|handles|performs)/i,
  /\bhelper (?:function|method) (?:to|for)\b/i,
  /\bfor example[,:]/i, /\bnote that\b/i, /\bkeep in mind\b/i,
  /\bit(?:'|')?s (?:important|worth) (?:to note|noting|mentioning)\b/i,
  /\b(?:é|e) importante (?:notar|ressaltar|destacar)\b/i,
  /\bvale (?:ressaltar|destacar|lembrar|notar)\b/i,
  /\bem (?:resumo|suma)\b/i, /\bpor fim\b/i,
  /\bhere(?:'|')?s how\b/i, /\bin (?:this|the following) (?:example|case)\b/i,
  /\b(?:Args|Returns|Raises|Parameters|Attributes|Yields|Example Usage|Usage Example)\s*:/,
  /\bdemonstrat(?:es|ing)\b/i, /\bensur(?:es|ing) that\b/i,
  /\b(?:robust|comprehensive|seamless|leverag\w+|utilize[sd]?)\b/i,
  /\b(?:realiza|efetua|executa) (?:a|o) (?:operação|processo|procedimento) de\b/i,
  /\bconforme (?:necessário|esperado)\b/i,
  /\b(?:main|entry point) (?:function|of the)\b/i,
];

/** Marcas de trabalho humano real: bagunça, dúvida, história. */
const HUMAN_MARKERS = [
  /\b(?:TODO|FIXME|XXX|HACK|WTF|NOTE to self|gambiarra|POG|por enquanto|depois eu|arrumar isso)\b/i,
  /\b(?:não sei|nao sei|acho que|testar isso|não mexer|nao mexer|quebra se|deu pau|bug chato)\b/i,
  /\b(?:temporar|provisor|workaround|ugly|hack feio|melhorar depois)/i,
  /\b(?:ticket|issue|jira|#\d{2,})\b/i,
  /\bcf\.|\bvide\b|\bver\b\s+(?:arquivo|doc|linha)/i,
  /https?:\/\/(?:stackoverflow|github|gist|developer\.mozilla)/i,
];

/** Nomes genéricos "de livro-texto". */
const GENERIC_NAMES = /\b(?:result|results|data|items|item|temp|tmp|value|values|output|input|response|obj|element|entry|payload|info|param|args|kwargs|helper|handler|processor|manager|util|utils|foo|bar)\b/g;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}]/u;

/**
 * Analisa o conteúdo de um arquivo e devolve os sinais heurísticos.
 * @param {string} content
 * @param {string} path
 */
function analyzeHeuristics(content, path) {
  const ext   = extOf(path);
  const lines = content.split(/\r?\n/);
  const { comment, code, blank } = classifyLines(lines, ext);

  const loc      = code.length;
  const commentN = comment.length;
  const total    = lines.length;
  const allText  = content;
  const commentText = comment.map(c => c.text).join('\n');

  const signals = [];
  const add = (name, score, weight, note) =>
    signals.push({ name, score: Math.max(0, Math.min(100, Math.round(score))), weight, note });

  // ── 1. Densidade de comentários ───────────────────────────────
  // Humano em projeto real: 0–12%. LLM: 20–40% e constante.
  const density = loc ? commentN / loc : 0;
  let densScore;
  if (density < 0.04)      densScore = 15;
  else if (density < 0.10) densScore = 30;
  else if (density < 0.18) densScore = 52;
  else if (density < 0.30) densScore = 74;
  else                     densScore = 88;
  add('Densidade de comentários', densScore, 1.1,
      `${commentN} linhas de comentário para ${loc} de código (${(density * 100).toFixed(0)}%).`);

  // ── 2. Comentários redundantes (reexplicam a linha seguinte) ──
  let redundant = 0;
  comment.forEach(c => {
    const next = lines[c.i + 1];
    if (!next || !next.trim()) return;
    const words = c.text.toLowerCase().match(/[a-zà-ú_]{4,}/g) || [];
    const ident = next.toLowerCase().match(/[a-z_][a-z0-9_]{3,}/g) || [];
    if (!words.length || !ident.length) return;
    const hits = words.filter(w => ident.some(id => id.includes(w) || w.includes(id)));
    if (hits.length / words.length > 0.5) redundant++;
  });
  const redRatio = commentN ? redundant / commentN : 0;
  add('Comentários redundantes', redRatio * 180, 1.2,
      redundant
        ? `${redundant} comentário(s) apenas repetem o que o código já diz.`
        : 'Nenhum comentário puramente redundante.');

  // ── 3. Fraseologia de LLM ─────────────────────────────────────
  const phraseHits = LLM_PHRASES.filter(r => r.test(allText));
  add('Fraseologia de LLM', Math.min(95, phraseHits.length * 22), 1.3,
      phraseHits.length
        ? `${phraseHits.length} padrão(ões) de redação típicos de LLM em comentários/docstrings.`
        : 'Sem fraseologia característica de LLM.');

  // ── 4. Ausência de marcas humanas ─────────────────────────────
  const humanHits = HUMAN_MARKERS.filter(r => r.test(allText)).length;
  add('Ausência de marcas de autoria', humanHits ? Math.max(8, 45 - humanHits * 18) : 72, 1.15,
      humanHits
        ? `${humanHits} marca(s) de trabalho humano (TODO, dúvida, link, ticket).`
        : 'Nenhum TODO, dúvida, gambiarra declarada ou referência externa — código "limpo demais".');

  // ── 5. Uniformidade estrutural ────────────────────────────────
  const lens = code.map(c => c.raw.replace(/\t/g, '    ').length).filter(n => n > 0);
  const sd   = stdev(lens);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const cv   = mean ? sd / mean : 0;           // coef. de variação
  add('Uniformidade estrutural', cv < 0.35 ? 80 : cv < 0.5 ? 62 : cv < 0.7 ? 40 : 22, 0.9,
      `Comprimento de linha com variação ${(cv * 100).toFixed(0)}% (baixa variação sugere geração automática).`);

  // ── 6. Nomes genéricos ────────────────────────────────────────
  const codeText   = code.map(c => c.text).join(' ');
  const idents     = codeText.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
  const genericHit = (codeText.match(GENERIC_NAMES) || []).length;
  const genRatio   = idents.length ? genericHit / idents.length : 0;
  add('Nomes genéricos', Math.min(92, genRatio * 900), 1.0,
      `${genericHit} ocorrência(s) de nomes genéricos (result, data, temp, handler...) em ${idents.length} identificadores.`);

  // ── 7. Tratamento de erro cerimonial ──────────────────────────
  const broadCatch = (allText.match(/except\s+Exception\s+as\s+e|catch\s*\(\s*(?:e|err|error)\s*\)|except\s*:/g) || []).length;
  const printErr   = (allText.match(/(?:console\.error|print)\s*\(\s*(?:f?["'`])?(?:Error|Erro|An error occurred|Ocorreu um erro)/gi) || []).length;
  add('Tratamento de erro genérico', Math.min(90, (broadCatch * 20) + (printErr * 25)), 0.85,
      broadCatch || printErr
        ? `${broadCatch} captura(s) genérica(s) e ${printErr} mensagem(ns) de erro padronizada(s).`
        : 'Sem blocos de erro genéricos padronizados.');

  // ── 8. Banners e decoração de seção ───────────────────────────
  const banners = comment.filter(c => /([=─━#*\-~═])\1{6,}/.test(c.text)).length;
  const emojis  = EMOJI_RE.test(commentText);
  add('Decoração de seções', Math.min(88, banners * 16 + (emojis ? 25 : 0)), 0.7,
      `${banners} banner(s) de separação${emojis ? ' e emojis em comentários' : ''}.`);

  // ── 9. Documentação exaustiva de assinaturas ──────────────────
  const fnCount  = (allText.match(/\b(?:function\s+\w+|def\s+\w+|=>\s*\{|func\s+\w+|public\s+\w+\s+\w+\s*\()/g) || []).length;
  const docCount = (allText.match(/\/\*\*|"""|'''|\/\/\/|#\s*@param/g) || []).length;
  const docRatio = fnCount ? Math.min(1.5, docCount / fnCount) : 0;
  add('Documentação exaustiva', fnCount ? docRatio * 62 : 30, 0.9,
      `${docCount} bloco(s) de documentação para ~${fnCount} função(ões)/método(s).`);

  // ── 10. Ausência de código morto ──────────────────────────────
  const pfx = commentPrefix(ext);
  const commentedCode = comment.filter(c => {
    const body = c.text.replace(new RegExp('^' + pfx.replace(/[/*]/g, '\\$&') + '+\\s*'), '');
    return /[;{}()=]\s*$|^\s*(?:if|for|while|return|const|let|var|def|print|console)\b/.test(body);
  }).length;
  add('Ausência de código morto', commentedCode ? 25 : 62, 0.6,
      commentedCode
        ? `${commentedCode} trecho(s) de código comentado (rastro de iteração humana).`
        : 'Nenhum código comentado — ausência de rastro de tentativa e erro.');

  // ── Agregação ponderada ───────────────────────────────────────
  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  const score = Math.round(
    signals.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight
  );

  return {
    score,
    signals,
    stats: {
      totalLines: total,
      loc,
      commentLines: commentN,
      blankLines: blank,
      commentDensity: +(density * 100).toFixed(1),
      functions: fnCount,
      humanMarkers: humanHits,
      llmPhrases: phraseHits.length,
      lengthVariation: +(cv * 100).toFixed(0),
      bytes: new Blob([content]).size,
    },
  };
}

/** Resumo textual dos sinais, para injetar no prompt do Claude. */
function heuristicsBrief(h) {
  const lines = h.signals.map(s => `- ${s.name}: ${s.score}/100 — ${s.note}`);
  return [
    `Pontuação heurística local: ${h.score}/100`,
    `Estatísticas: ${h.stats.loc} LOC, ${h.stats.commentLines} linhas de comentário ` +
    `(${h.stats.commentDensity}%), ~${h.stats.functions} funções, ` +
    `${h.stats.humanMarkers} marcas humanas, ${h.stats.llmPhrases} frases de LLM, ` +
    `variação de comprimento de linha ${h.stats.lengthVariation}%.`,
    'Sinais:',
    ...lines,
  ].join('\n');
}
