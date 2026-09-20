/**
 * forensics.js — Rastros técnicos deixados por geração automática
 *
 * Camada determinística, local e gratuita. Não usa API e não depende de
 * julgamento estatístico: procura vestígios que ou estão presentes ou não.
 *
 * Três famílias de rastro:
 *
 *   1. CARACTERES INVISÍVEIS — zero-width, joiners, soft hyphen, tags.
 *      Quem digita não produz esses bytes. Aparecem por marca d'água
 *      deliberada, por cópia de interface de chat, ou por ferramenta de
 *      "humanização" que tenta furar detector exato.
 *
 *   2. ASSINATURA TIPOGRÁFICA — travessão, aspas curvas, reticências de
 *      um caractere, espaço fino. Em PROSA são fracos (o Word autocorrige).
 *      Em CÓDIGO são fortes: nenhum editor de código autocorrige isso, e
 *      quem digita num teclado ABNT2 produz "-" e '"', não "—" e "".
 *
 *   3. PROCEDÊNCIA DECLARADA — o assistente assinou o trabalho.
 *      Trailer de commit, cabeçalho de arquivo, marcador de ferramenta.
 *      É o rastro mais forte que existe: não é inferência, é confissão.
 *
 * Para inglês, delega ao motor vendorizado em vendor/avoid-ai-writing
 * (MIT, conorbronsdon). Este arquivo cobre o que ele não cobre:
 * português e código-fonte.
 */

'use strict';

// ════════════════════════════════════════════════
//  1. CARACTERES INVISÍVEIS
// ════════════════════════════════════════════════
const INVISIBLE = [
  { re: /​/g, code: 'U+200B', name: 'espaço de largura zero (ZWSP)' },
  { re: /‌/g, code: 'U+200C', name: 'não-juntador de largura zero (ZWNJ)' },
  { re: /‍/g, code: 'U+200D', name: 'juntador de largura zero (ZWJ)' },
  { re: /⁠/g, code: 'U+2060', name: 'juntador de palavra' },
  { re: /﻿/g, code: 'U+FEFF', name: 'espaço sem quebra de largura zero (BOM interno)' },
  { re: /­/g, code: 'U+00AD', name: 'hífen suave' },
  { re: /[᠎‎‏‪-‮⁦-⁩]/g, code: 'U+202x', name: 'marca de direção de texto' },
  { re: /[\uDB40][\uDC00-\uDC7F]/g, code: 'U+E00xx', name: 'caractere de tag (Unicode Tags)' },
  { re: /[︀-️]/g, code: 'U+FE0x', name: 'seletor de variação' },
];

// ════════════════════════════════════════════════
//  2. ASSINATURA TIPOGRÁFICA
// ════════════════════════════════════════════════
const TYPOGRAPHIC = [
  { re: /—/g,        code: 'U+2014', name: 'travessão (em dash)',        weightCode: 10, weightText: 3 },
  { re: /–/g,        code: 'U+2013', name: 'meia-risca (en dash)',       weightCode: 8,  weightText: 2 },
  { re: /[‘’]/g, code: 'U+2019', name: 'aspa simples curva',   weightCode: 9,  weightText: 2 },
  { re: /[“”]/g, code: 'U+201C', name: 'aspa dupla curva',     weightCode: 9,  weightText: 2 },
  { re: /…/g,        code: 'U+2026', name: 'reticências de um caractere', weightCode: 8, weightText: 2 },
  { re: / /g,   code: 'U+00A0', name: 'espaço sem quebra',          weightCode: 7,  weightText: 2 },
  { re: / /g,   code: 'U+202F', name: 'espaço fino sem quebra',     weightCode: 8,  weightText: 3 },
  { re: /[−×]/g, code: 'U+2212', name: 'sinal matemático tipográfico', weightCode: 6, weightText: 1 },
];

/** Letras latinas com sósia em cirílico/grego — usadas para furar detector. */
const HOMOGLYPHS = /[аеорсхукмнвтАЕОРСХοΟαΑρΡ]/g;

// ════════════════════════════════════════════════
//  3. PROCEDÊNCIA DECLARADA
// ════════════════════════════════════════════════
const PROVENANCE = [
  { re: /Co-Authored-By:\s*Claude/i,                name: 'trailer de commit do Claude Code', weight: 100 },
  { re: /Generated with \[?Claude Code\]?/i,        name: 'assinatura do Claude Code',        weight: 100 },
  { re: /🤖\s*Generated with/i,                     name: 'assinatura de geração automática', weight: 100 },
  { re: /Co-authored-by:\s*(?:GitHub )?Copilot/i,   name: 'trailer do GitHub Copilot',        weight: 100 },
  { re: /noreply@anthropic\.com/i,                  name: 'e-mail de autoria da Anthropic',   weight: 100 },
  { re: /\b(?:generated|created|written)\s+(?:by|with|using)\s+(?:chatgpt|gpt-[45]|claude|gemini|copilot|cursor|codeium|windsurf)\b/i,
    name: 'declaração de geração no próprio texto', weight: 95 },
  { re: /\b(?:gerado|criado|escrito)\s+(?:por|com|usando)\s+(?:chatgpt|claude|gemini|copilot|ia)\b/i,
    name: 'declaração de geração (português)',      weight: 95 },
  { re: /@generated\b|@ai-generated\b/i,            name: 'marcador @generated',              weight: 85 },
  { re: /\butm_source=(?:chatgpt|openai|perplexity|claude|copilot)\b/i,
    name: 'parâmetro de URL de ferramenta de IA',   weight: 90 },
  { re: /:contentReference\[oaicite:|【\d+†source】/,
    name: 'marcação de citação vazada do chatbot',  weight: 95 },
  { re: /\[(?:insert|your|add)\s+[a-z\s]{3,20}(?:here)?\]|<(?:INSERT|YOUR|TODO)[_A-Z\s]{2,20}>/i,
    name: 'placeholder não preenchido',             weight: 70 },
  { re: /\bAs an AI language model\b|\bComo um modelo de linguagem\b/i,
    name: 'recusa/disclaimer de assistente vazado', weight: 100 },
  { re: /\bknowledge cutoff\b|\bmy training data\b|\bmeu conhecimento vai até\b/i,
    name: 'disclaimer de corte de conhecimento',    weight: 90 },
];

// ════════════════════════════════════════════════
//  4. VOCABULÁRIO — PORTUGUÊS
//  O motor vendorizado cobre inglês. Estas são as equivalentes em PT-BR.
// ════════════════════════════════════════════════
const PT_PHRASES = [
  { re: /\bé\s+important[ea]\s+(?:notar|ressaltar|destacar|mencionar|lembrar)\b/gi, name: '"é importante notar"' },
  { re: /\bvale\s+(?:ressaltar|destacar|lembrar|mencionar|notar|a pena)\b/gi,       name: '"vale ressaltar"' },
  { re: /\bem\s+(?:um\s+)?(?:cenário|contexto|panorama)\s+(?:atual|contemporâneo|em constante evolução)\b/gi, name: '"cenário em constante evolução"' },
  { re: /\bdesempenh[ao]\s+um\s+papel\s+(?:fundamental|crucial|essencial|central)\b/gi, name: '"desempenha um papel fundamental"' },
  { re: /\b(?:representa|constitui)\s+um\s+(?:avanço|marco|divisor)\s+(?:significativo|importante)\b/gi, name: '"representa um avanço significativo"' },
  { re: /\bde\s+suma\s+importância\b/gi,                     name: '"de suma importância"' },
  { re: /\bum\s+verdadeiro\s+(?:testemunho|reflexo)\b/gi,    name: '"um verdadeiro testemunho"' },
  { re: /\bno\s+mundo\s+(?:digital\s+)?(?:atual|moderno|contemporâneo)\b/gi, name: '"no mundo atual"' },
  { re: /\bmergulh(?:ar|ando|o)\s+(?:fundo\s+)?n[oa]\b/gi,   name: '"mergulhar fundo em"' },
  { re: /\bpor\s+fim,\s*(?:mas\s+não\s+menos\s+importante)\b/gi, name: '"por fim, mas não menos importante"' },
  { re: /\bem\s+(?:resumo|suma|síntese),\b/gi,               name: '"em resumo/em suma"' },
  { re: /\b(?:robust[oa]|abrangente|inovador[a]?|significativ[oa]|substancial|primordial)\b/gi, name: 'adjetivo inflado' },
  { re: /\bproporcion(?:a|ando)\s+(?:maior|uma\s+maior)\b/gi, name: '"proporcionando maior"' },
  { re: /\bespero\s+que\s+(?:isso\s+)?ajude\b|\bfique\s+à\s+vontade\s+para\b/gi, name: 'resíduo de chat' },
  { re: /\bcom\s+base\s+n[oa]s\s+informações\s+fornecidas\b/gi, name: '"com base nas informações fornecidas"' },
];

// ════════════════════════════════════════════════
//  UTILITÁRIOS
// ════════════════════════════════════════════════
function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

/** Localiza a linha (1-indexada) da primeira ocorrência. */
function firstLine(text, re) {
  const r = new RegExp(re.source, re.flags.replace('g', ''));
  const i = text.search(r);
  if (i < 0) return null;
  return text.slice(0, i).split(/\r?\n/).length;
}

// ════════════════════════════════════════════════
//  VARREDURA PRINCIPAL
// ════════════════════════════════════════════════

/**
 * Procura rastros técnicos em qualquer conteúdo.
 * @param {string} content
 * @param {{mode?: 'text'|'code', lang?: string}} opts
 * @returns {{score:number, conclusive:boolean, traces:Array, summary:string}}
 */
function scanTraces(content, opts = {}) {
  const mode   = opts.mode === 'code' ? 'code' : 'text';
  const text   = String(content || '');
  const words  = text.trim().split(/\s+/).filter(Boolean).length || 1;
  const traces = [];

  // ── 1. Invisíveis ───────────────────────────────────────────
  let invisibleTotal = 0;
  INVISIBLE.forEach(({ re, code, name }) => {
    const n = countMatches(text, re);
    if (!n) return;
    invisibleTotal += n;
    traces.push({
      family: 'invisivel',
      severity: 'critico',
      name: `${name} (${code})`,
      count: n,
      line: firstLine(text, re),
      note: 'Caractere sem representação visual. Não é produzido ao digitar.',
    });
  });

  // ── 2. Homóglifos ───────────────────────────────────────────
  const homo = countMatches(text, HOMOGLYPHS);
  if (homo > 0) {
    traces.push({
      family: 'invisivel',
      severity: 'critico',
      name: 'letra cirílica/grega sósia de latina',
      count: homo,
      line: firstLine(text, HOMOGLYPHS),
      note: 'Troca usada para enganar detector de string exata. Indica passagem por ferramenta de "humanização".',
    });
  }

  // ── 3. Procedência declarada ────────────────────────────────
  PROVENANCE.forEach(({ re, name, weight }) => {
    if (!re.test(text)) return;
    traces.push({
      family: 'procedencia',
      severity: 'critico',
      name,
      count: countMatches(text, new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')),
      line: firstLine(text, re),
      weight,
      note: 'O próprio conteúdo declara a origem automática.',
    });
  });

  // ── 4. Tipografia ───────────────────────────────────────────
  // Em código isso pesa muito mais: editor de código não autocorrige.
  // Em prosa, Word e Google Docs produzem os mesmos caracteres.
  const scope = mode === 'code' ? commentsAndStrings(text, opts.lang) : text;
  TYPOGRAPHIC.forEach(({ re, code, name, weightCode, weightText }) => {
    const n = countMatches(scope, re);
    if (!n) return;
    const per1k = (n / words) * 1000;
    const strong = mode === 'code' ? n >= 1 : per1k >= 4;
    if (!strong) return;
    traces.push({
      family: 'tipografia',
      severity: mode === 'code' ? 'alto' : 'medio',
      name: `${name} (${code})`,
      count: n,
      line: firstLine(scope, re),
      weight: mode === 'code' ? weightCode : weightText,
      note: mode === 'code'
        ? 'Editor de código não gera este caractere. Digitação manual produz o equivalente ASCII.'
        : `Densidade de ${per1k.toFixed(1)} por mil palavras. Processador de texto também autocorrige — sinal fraco isolado.`,
    });
  });

  // ── 5. Vocabulário em português ─────────────────────────────
  let ptHits = 0;
  PT_PHRASES.forEach(({ re, name }) => {
    const n = countMatches(text, re);
    if (!n) return;
    ptHits += n;
    traces.push({
      family: 'vocabulario',
      severity: 'baixo',
      name,
      count: n,
      line: firstLine(text, re),
      note: 'Fórmula estatisticamente sobre-representada em saída de LLM em português.',
    });
  });

  // ── Pontuação ───────────────────────────────────────────────
  // Invisíveis e procedência são categóricos: presença = quase certeza.
  // Tipografia e vocabulário acumulam, mas saturam.
  const conclusive = traces.some(t => t.family === 'procedencia')
                  || invisibleTotal >= 3 || homo >= 3;

  let score = 0;
  if (traces.some(t => t.family === 'procedencia')) score = 100;
  else {
    score += Math.min(60, invisibleTotal * 20);
    score += Math.min(30, homo * 10);
    score += Math.min(mode === 'code' ? 45 : 20,
      traces.filter(t => t.family === 'tipografia').reduce((a, t) => a + (t.weight || 3), 0));
    score += Math.min(25, ptHits * 4);
    score = Math.min(100, Math.round(score));
  }

  return {
    score,
    conclusive,
    traces: traces.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.count - a.count),
    summary: buildSummary(traces, conclusive, mode),
  };
}

function sevRank(s) {
  return { critico: 3, alto: 2, medio: 1, baixo: 0 }[s] ?? 0;
}

function buildSummary(traces, conclusive, mode) {
  if (!traces.length) {
    return mode === 'code'
      ? 'Nenhum rastro técnico encontrado. Isso não prova autoria humana — apenas que não há vestígio material.'
      : 'Nenhum rastro técnico encontrado. A ausência de rastro não prova autoria humana.';
  }
  const prov = traces.filter(t => t.family === 'procedencia');
  if (prov.length) {
    return `Procedência declarada no próprio conteúdo: ${prov.map(t => t.name).join('; ')}. ` +
           'Isto não é estimativa estatística — o material carrega a assinatura da ferramenta que o produziu.';
  }
  if (conclusive) {
    return 'Caracteres invisíveis ou sósias em quantidade que não ocorre por digitação. ' +
           'Indica marca d\'água, cópia direta de interface de chat, ou passagem por ferramenta de "humanização".';
  }
  return `${traces.length} vestígio(s) encontrado(s), nenhum conclusivo isoladamente. ` +
         'Vale como corroboração da análise linguística, não como prova.';
}

// ════════════════════════════════════════════════
//  RECORTE DE COMENTÁRIOS E STRINGS (modo código)
//  Travessão dentro de uma string de UI é legítimo; dentro de um
//  comentário de código é rastro. Recortamos as duas regiões e
//  deixamos o resto do código de fora para não gerar falso positivo.
// ════════════════════════════════════════════════
function commentsAndStrings(code, lang) {
  const out = [];
  const lines = code.split(/\r?\n/);
  const hashLang = /python|ruby|shell|yaml|powershell|r\b/i.test(lang || '');
  const pfx = hashLang ? '#' : '//';
  let inBlock = false;

  lines.forEach(raw => {
    const line = raw.trim();
    if (inBlock) {
      out.push(line);
      if (/\*\/|"""|'''/.test(line)) inBlock = false;
      return;
    }
    if (/^\/\*|^"""|^'''/.test(line) && !/\*\/$|"""$|'''$/.test(line.slice(3))) {
      inBlock = true; out.push(line); return;
    }
    if (line.startsWith(pfx) || line.startsWith('*') || line.startsWith('<!--')) {
      out.push(line); return;
    }
    // comentário no fim da linha
    const idx = raw.indexOf(pfx);
    if (idx > 0) out.push(raw.slice(idx));
  });

  return out.join('\n');
}

// ════════════════════════════════════════════════
//  PONTE COM O MOTOR VENDORIZADO (inglês)
// ════════════════════════════════════════════════

/** Roda o avoid-ai-writing quando disponível. Devolve null se ausente. */
function scanEnglishPatterns(text, mode) {
  if (typeof AIDetector === 'undefined' || !AIDetector.analyzeText) return null;
  try {
    const r = AIDetector.analyzeText(text, {
      contextMode: mode === 'code' ? 'technical' : 'general',
    });
    if (!r || r.tooShort) return null;
    return {
      score: r.score || 0,
      label: r.label || '',
      issues: (r.issues || []).slice(0, 25).map(i => ({
        type: i.type,
        label: (AIDetector.TYPE_LABELS && AIDetector.TYPE_LABELS[i.type]) || i.type,
        text: String(i.text || '').slice(0, 120),
        severity: i.severity || '',
      })),
    };
  } catch (err) {
    console.warn('[forensics] avoid-ai-writing falhou:', err.message);
    return null;
  }
}

/** Varredura completa: rastros próprios + motor vendorizado. */
function runForensics(content, opts = {}) {
  const traces  = scanTraces(content, opts);
  const english = scanEnglishPatterns(content, opts.mode);
  return { ...traces, english };
}

/** Remove rastros invisíveis. Usado só na reescrita de TEXTO, nunca em código. */
function stripInvisible(text) {
  let out = String(text || '');
  INVISIBLE.forEach(({ re }) => { out = out.replace(re, ''); });
  return out;
}
