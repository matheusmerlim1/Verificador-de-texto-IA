/**
 * report.js — Renderização e exportação do relatório de projeto
 *
 * Produz a visão consolidada (percentual por documento + sugestões)
 * e exporta em Markdown, JSON ou impressão/PDF.
 */

'use strict';

let LAST_REPORT = null;

// ════════════════════════════════════════════════
//  RENDERIZAÇÃO
// ════════════════════════════════════════════════
function renderReport(rep) {
  LAST_REPORT = rep;
  hide('code-empty');
  show('report', 'flex');

  renderReportHeader(rep);
  renderDistribution(rep);
  renderFileTable(rep);
  renderGlobalSuggestions(rep);
  renderFileDetails(rep);
}

function renderReportHeader(rep) {
  const color = getColor(rep.weighted);
  const v     = getVerdict(rep.weighted);

  $('rep-project').textContent = rep.project;
  $('rep-meta').textContent =
    `${rep.files.length} arquivo(s) · ${rep.totalLoc} linhas de código · ` +
    `${rep.model} · ${rep.generatedAt.toLocaleString('pt-BR')}`;

  $('rep-score').textContent   = rep.weighted + '%';
  $('rep-score').style.color   = color;
  $('rep-verdict').textContent = v.label;
  $('rep-verdict').style.color = v.color;
  $('rep-simple').textContent  = `média simples por arquivo: ${rep.simple}%`;

  requestAnimationFrame(() => {
    $('rep-fill').style.width      = rep.weighted + '%';
    $('rep-fill').style.background = color;
  });
}

function renderDistribution(rep) {
  const { human, mixed, ai } = rep.buckets;
  const n = rep.files.length || 1;
  const rows = [
    { label: 'Predominantemente humano', hint: '0–40%',   n: human, color: '#27ae60' },
    { label: 'Misto / inconclusivo',     hint: '41–65%',  n: mixed, color: '#e67e22' },
    { label: 'Predominantemente IA',     hint: '66–100%', n: ai,    color: '#c0392b' },
  ];

  $('rep-dist').innerHTML = rows.map(r => `
    <div class="dist-row">
      <div class="dist-head">
        <span class="dist-label">${r.label} <span class="dist-hint">${r.hint}</span></span>
        <span class="dist-n" style="color:${r.color}">${r.n} arquivo(s)</span>
      </div>
      <div class="dist-track">
        <div class="dist-fill" style="width:${(r.n / n * 100).toFixed(1)}%;background:${r.color}"></div>
      </div>
    </div>`).join('');
}

function renderFileTable(rep) {
  const body = rep.files.map(f => {
    const c = getColor(f.score);
    return `
      <tr data-path="${escHtml(f.path)}" class="file-score-row">
        <td class="td-path" title="${escHtml(f.path)}">${escHtml(f.path)}</td>
        <td class="td-lang">${escHtml(f.lang)}</td>
        <td class="td-loc">${f.stats?.loc ?? '—'}</td>
        <td class="td-score">
          <div class="score-cell">
            <span style="color:${c};font-weight:600">${f.score}%</span>
            <div class="score-mini"><div style="width:${f.score}%;background:${c}"></div></div>
          </div>
        </td>
        <td class="td-conf">${escHtml(f.error ? 'erro' : f.confidence)}</td>
      </tr>`;
  }).join('');

  $('rep-table').innerHTML = `
    <table class="report-table">
      <thead>
        <tr>
          <th>Documento</th><th>Linguagem</th><th>LOC</th>
          <th>% IA</th><th>Confiança</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;

  // Clicar na linha rola até o detalhe do arquivo
  $('rep-table').querySelectorAll('.file-score-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const el = document.querySelector(`[data-detail="${CSS.escape(tr.dataset.path)}"]`);
      if (!el) return;
      el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function renderGlobalSuggestions(rep) {
  if (!rep.globalSuggestions.length) {
    $('rep-global').innerHTML = '<div class="sugg-empty">Nenhuma alteração recomendada — o projeto já apresenta marcas consistentes de autoria.</div>';
    return;
  }

  $('rep-global').innerHTML = rep.globalSuggestions.map((s, i) => `
    <div class="sugg">
      <div class="sugg-top">
        <span class="sugg-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="sugg-action">${escHtml(s.action)}</span>
      </div>
      <div class="sugg-meta">
        <span class="tag tag-${escHtml(s.impact || 'medio')}">impacto ${escHtml(s.impact || 'médio')}</span>
        <span class="tag">esforço ${escHtml(s.effort || 'médio')}</span>
        <span class="tag">${s.files.length} arquivo(s)</span>
      </div>
      ${s.rationale ? `<div class="sugg-why">${escHtml(s.rationale)}</div>` : ''}
      <div class="sugg-files">${s.files.slice(0, 6).map(f => `<code>${escHtml(f)}</code>`).join(' ')}${s.files.length > 6 ? ` <span class="muted">+${s.files.length - 6}</span>` : ''}</div>
    </div>`).join('');
}

function renderFileDetails(rep) {
  $('rep-details').innerHTML = rep.files.map(f => {
    const c = getColor(f.score);

    const signals = (f.signals || []).map(s => `
      <div class="det-signal">
        <div class="det-signal-head">
          <span>${escHtml(s.name)}</span>
          <span style="color:${getColor(s.score)}">${s.score ?? '—'}%</span>
        </div>
        <div class="det-signal-ev">${escHtml(s.evidence || s.note || '')}</div>
      </div>`).join('');

    const hotspots = (f.hotspots || []).length ? `
      <div class="det-block">
        <div class="det-block-title">Trechos mais suspeitos</div>
        ${f.hotspots.map(h => `
          <div class="hotspot">
            <code>linhas ${escHtml(h.lines)}</code>
            <span style="color:${getColor(h.score)}">${h.score}%</span>
            <div class="hotspot-why">${escHtml(h.why)}</div>
          </div>`).join('')}
      </div>` : '';

    const suggestions = (f.suggestions || []).length ? `
      <div class="det-block">
        <div class="det-block-title">O que alterar neste arquivo</div>
        ${f.suggestions.map(s => `
          <div class="det-sugg">
            <div class="det-sugg-action">${escHtml(s.action)}</div>
            <div class="sugg-meta">
              ${s.where ? `<span class="tag">${escHtml(s.where)}</span>` : ''}
              <span class="tag tag-${escHtml(s.impact || 'medio')}">impacto ${escHtml(s.impact || 'médio')}</span>
              <span class="tag">esforço ${escHtml(s.effort || 'médio')}</span>
            </div>
            ${s.rationale ? `<div class="sugg-why">${escHtml(s.rationale)}</div>` : ''}
          </div>`).join('')}
      </div>` : '';

    const fo = f.forensics;
    const traces = fo && fo.traces.length ? `
      <div class="det-block">
        <div class="det-block-title">Rastros materiais${fo.conclusive ? ' — CONCLUSIVO' : ''}</div>
        ${fo.traces.map(t => `
          <div class="trace sev-${escHtml(t.severity)}">
            <div class="trace-top">
              <span class="trace-name">${escHtml(t.name)}</span>
              <span class="trace-count">${t.count}x${t.line ? ' · linha ' + t.line : ''}</span>
            </div>
            <div class="trace-note">${escHtml(t.note)}</div>
          </div>`).join('')}
      </div>` : '';

    const scores = [
      f.aiScore        !== null ? `semântica (Claude): ${f.aiScore}%` : null,
      f.heuristicScore !== null ? `heurística local: ${f.heuristicScore}%` : null,
    ].filter(Boolean).join(' · ');

    return `
      <details class="det" data-detail="${escHtml(f.path)}">
        <summary class="det-summary">
          <span class="det-score" style="color:${c}">${f.score}%</span>
          <span class="det-path">${escHtml(f.path)}</span>
          <span class="det-verdict">${escHtml(f.verdict || '')}</span>
        </summary>
        <div class="det-body">
          ${f.error ? `<div class="det-error">⚠️ ${escHtml(f.error)} — usada apenas a heurística local.</div>` : ''}
          <div class="det-scores">${escHtml(scores)}</div>
          ${f.summary ? `<div class="det-summary-text">${escHtml(f.summary)}</div>` : ''}
          ${f.stats ? `<div class="det-stats">${f.stats.loc} LOC · ${f.stats.commentLines} comentários (${f.stats.commentDensity}%) · ~${f.stats.functions} funções · ${f.stats.humanMarkers} marcas humanas · variação de linha ${f.stats.lengthVariation}%</div>` : ''}
          <div class="det-block">
            <div class="det-block-title">Sinais detectados</div>
            ${signals || '<div class="muted">—</div>'}
          </div>
          ${traces}
          ${hotspots}
          ${suggestions}
        </div>
      </details>`;
  }).join('');
}

// ════════════════════════════════════════════════
//  EXPORTAÇÃO
// ════════════════════════════════════════════════
function reportToMarkdown(rep) {
  const L = [];
  const v = getVerdict(rep.weighted);

  L.push(`# Relatório de autoria de código — ${rep.project}`);
  L.push('');
  L.push(`**Gerado em:** ${rep.generatedAt.toLocaleString('pt-BR')}  `);
  L.push(`**Método:** ${rep.model}  `);
  L.push(`**Arquivos analisados:** ${rep.files.length} (${rep.totalLoc} linhas de código)`);
  L.push('');
  L.push('## Resultado consolidado');
  L.push('');
  L.push(`| Métrica | Valor |`);
  L.push(`|---|---|`);
  L.push(`| Percentual de código com características de IA (ponderado por LOC) | **${rep.weighted}%** |`);
  L.push(`| Média simples por arquivo | ${rep.simple}% |`);
  L.push(`| Classificação | ${v.label} |`);
  L.push(`| Arquivos predominantemente humanos (0–40%) | ${rep.buckets.human} |`);
  L.push(`| Arquivos mistos (41–65%) | ${rep.buckets.mixed} |`);
  L.push(`| Arquivos predominantemente de IA (66–100%) | ${rep.buckets.ai} |`);
  L.push('');
  L.push('## Percentual por documento');
  L.push('');
  L.push('| Documento | Linguagem | LOC | % IA | Rastro | Confiança |');
  L.push('|---|---|---:|---:|---|---|');
  rep.files.forEach(f => {
    const fo = f.forensics;
    const marca = fo && fo.conclusive ? '**MATERIAL**' : (fo && fo.traces.length ? `${fo.traces.length} vestígio(s)` : '—');
    L.push(`| \`${f.path}\` | ${f.lang} | ${f.stats?.loc ?? '—'} | **${f.score}%** | ${marca} | ${f.error ? 'erro' : f.confidence} |`);
  });
  L.push('');

  const comRastro = rep.files.filter(f => f.forensics && f.forensics.traces.length);
  if (comRastro.length) {
    L.push('## Rastros materiais');
    L.push('');
    L.push('Vestígios que não dependem de julgamento estatístico: ou estão no arquivo, ou não estão.');
    L.push('');
    comRastro.forEach(f => {
      L.push(`### \`${f.path}\`${f.forensics.conclusive ? ' — CONCLUSIVO' : ''}`);
      L.push('');
      f.forensics.traces.forEach(t =>
        L.push(`- **${t.name}** — ${t.count}x${t.line ? ` (linha ${t.line})` : ''}. ${t.note}`));
      L.push('');
    });
  }
  L.push('');

  if (rep.globalSuggestions.length) {
    L.push('## Ações prioritárias no projeto');
    L.push('');
    rep.globalSuggestions.forEach((s, i) => {
      L.push(`${i + 1}. **${s.action}**`);
      L.push(`   - Impacto: ${s.impact || 'médio'} · Esforço: ${s.effort || 'médio'} · ${s.files.length} arquivo(s)`);
      if (s.rationale) L.push(`   - Por quê: ${s.rationale}`);
      L.push(`   - Onde: ${s.files.slice(0, 8).map(f => `\`${f}\``).join(', ')}${s.files.length > 8 ? ` e mais ${s.files.length - 8}` : ''}`);
      L.push('');
    });
  }

  L.push('## Detalhamento por arquivo');
  L.push('');
  rep.files.forEach(f => {
    L.push(`### \`${f.path}\` — ${f.score}%`);
    L.push('');
    if (f.verdict) L.push(`*${f.verdict}*`);
    if (f.summary) { L.push(''); L.push(f.summary); }
    L.push('');
    if (f.stats) {
      L.push(`**Estatísticas:** ${f.stats.loc} LOC · ${f.stats.commentLines} linhas de comentário (${f.stats.commentDensity}%) · ~${f.stats.functions} funções · ${f.stats.humanMarkers} marcas humanas · variação de comprimento de linha ${f.stats.lengthVariation}%`);
      L.push('');
    }
    if ((f.signals || []).length) {
      L.push('**Sinais:**');
      L.push('');
      f.signals.forEach(s => L.push(`- ${s.name} (${s.score}%): ${s.evidence || s.note || ''}`));
      L.push('');
    }
    if ((f.hotspots || []).length) {
      L.push('**Trechos mais suspeitos:**');
      L.push('');
      f.hotspots.forEach(h => L.push(`- Linhas ${h.lines} (${h.score}%): ${h.why}`));
      L.push('');
    }
    if ((f.suggestions || []).length) {
      L.push('**O que alterar:**');
      L.push('');
      f.suggestions.forEach(s => {
        L.push(`- ${s.action}`);
        L.push(`  - Onde: ${s.where || 'arquivo inteiro'} · Impacto: ${s.impact || 'médio'} · Esforço: ${s.effort || 'médio'}`);
        if (s.rationale) L.push(`  - Por quê: ${s.rationale}`);
      });
      L.push('');
    }
  });

  L.push('---');
  L.push('');
  L.push('> **Nota metodológica.** Este relatório é uma estimativa probabilística baseada em');
  L.push('> análise estática e avaliação linguística. Nenhum detector de autoria é conclusivo:');
  L.push('> código idiomático, formatado por linter ou seguindo padrão de equipe pode elevar a');
  L.push('> pontuação sem ter sido gerado por IA. Reduzir o percentual não altera a autoria real');
  L.push('> do código — as sugestões visam tornar o código mais específico do domínio e mais');
  L.push('> legível, o que é benéfico independentemente da questão de autoria.');
  L.push('');
  L.push('> **Somente leitura.** Nenhum arquivo do projeto analisado foi modificado.');

  return L.join('\n');
}

function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return String(s).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'projeto';
}

function initReportExports() {
  $('btn-export-md').addEventListener('click', () => {
    if (!LAST_REPORT) return;
    download(`relatorio-ia-${slug(LAST_REPORT.project)}.md`, reportToMarkdown(LAST_REPORT), 'text/markdown;charset=utf-8');
  });

  $('btn-export-json').addEventListener('click', () => {
    if (!LAST_REPORT) return;
    download(
      `relatorio-ia-${slug(LAST_REPORT.project)}.json`,
      JSON.stringify({ ...LAST_REPORT, generatedAt: LAST_REPORT.generatedAt.toISOString() }, null, 2),
      'application/json;charset=utf-8'
    );
  });

  $('btn-export-csv').addEventListener('click', () => {
    if (!LAST_REPORT) return;
    const rows = [['documento', 'linguagem', 'loc', 'percentual_ia', 'heuristica', 'semantica', 'confianca']];
    LAST_REPORT.files.forEach(f => rows.push([
      f.path, f.lang, f.stats?.loc ?? '', f.score,
      f.heuristicScore ?? '', f.aiScore ?? '', f.confidence,
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`relatorio-ia-${slug(LAST_REPORT.project)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  });

  // Abre todos os detalhes antes de imprimir: <details> fechado não sai no PDF.
  $('btn-print').addEventListener('click', () => {
    const opened = $$('#rep-details .det').filter(d => !d.open);
    opened.forEach(d => { d.open = true; });
    window.print();
    setTimeout(() => opened.forEach(d => { d.open = false; }), 500);
  });
}

document.addEventListener('DOMContentLoaded', initReportExports);
