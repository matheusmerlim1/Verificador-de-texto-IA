/**
 * public/js/app.js
 * Responsabilidade: toda a lógica do cliente.
 * Chama POST /api/analyze (backend), nunca a API da Anthropic diretamente.
 */

'use strict';

// ── Exemplos de texto ────────────────────────────────────────────────────────
const EXAMPLES = {
  human: `Cara, tentei usar aquele sistema que você me indicou e não funcionou de jeito nenhum. Fiquei mais de duas horas tentando configurar e nada. Acho que o problema é na parte de autenticação porque o erro aparece logo quando eu boto o endereço da carteira. Já tentei reinstalar tudo e ainda assim aparece o mesmo negócio. Alguém sabe o que pode ser? Cheguei a desconfiar que era problema do meu computador, mas meu colega testou no dele e deu o mesmo pau. Fico irritado com essas coisas porque perco tempo que poderia usar pra outras coisas.`,

  ai: `A implementação de sistemas de gestão de direitos digitais baseados em tecnologia blockchain representa um avanço significativo no contexto da proteção de propriedade intelectual no ambiente digital contemporâneo. Através da utilização de contratos inteligentes, é possível garantir a unicidade e a rastreabilidade dos ativos digitais, estabelecendo um paradigma inovador para a comercialização e distribuição de conteúdo. Esta abordagem oferece vantagens substanciais em relação aos modelos tradicionais de DRM, proporcionando maior transparência, segurança e autonomia aos usuários. Os resultados demonstram que a solução proposta apresenta escalabilidade adequada para múltiplas editoras, mantendo a integridade dos direitos autorais.`,

  academic: `O presente trabalho tem como objetivo propor um modelo de empréstimo digital baseado na tecnologia Blockchain. A metodologia empregada seguiu a abordagem Design Science Research, conforme proposto por Hevner et al. (2004). Os dados foram coletados por meio de testes em ambiente controlado utilizando o simulador Ganache, resultando em tempo médio de validação de 1,2 segundos por transação. Conclui-se que o modelo apresenta viabilidade técnica para o contexto proposto, embora apresente limitações decorrentes da dependência de conectividade de rede para a execução das validações em tempo real.`,

  mixed: `Quando comecei a estudar blockchain achei muito complicado, mas depois fui entendendo melhor. A tecnologia de contratos inteligentes permite que as transações sejam executadas de forma automática e transparente, eliminando a necessidade de intermediários. Isso é muito útil pra revenda de ebooks, por exemplo. O sistema que a gente desenvolveu funciona assim: o arquivo fica criptografado e só abre se a blockchain confirmar que você é o dono. Testamos em rede local e funcionou bem, com latência em torno de 1,2 segundos.`,
};

// ── Elementos DOM ────────────────────────────────────────────────────────────
const txtEl  = document.getElementById('txt');
const wcEl   = document.getElementById('wc');
const btnEl  = document.getElementById('btn-analyze');

// ── Word count ────────────────────────────────────────────────────────────────
txtEl.addEventListener('input', () => {
  const words = txtEl.value.trim().split(/\s+/).filter(Boolean).length;
  wcEl.textContent = words;
  btnEl.disabled = words < 20;
});

document.getElementById('btn-clear').addEventListener('click', () => {
  txtEl.value = '';
  wcEl.textContent = '0';
  btnEl.disabled = true;
  resetUI();
});

// ── Exemplos ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    txtEl.value = EXAMPLES[chip.dataset.id] || '';
    txtEl.dispatchEvent(new Event('input'));
  });
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function resetUI() {
  show('empty-state',   'flex');
  show('loading-state', 'none');
  show('gauge-wrap',    'none');
  show('indicators',    'none');
  show('analysis-box',  'none');
}

function showLoading(msg = 'ANALISANDO PADRÕES LINGUÍSTICOS...') {
  show('empty-state',   'none');
  show('loading-state', 'flex');
  show('gauge-wrap',    'none');
  show('indicators',    'none');
  show('analysis-box',  'none');
  document.getElementById('loading-msg').textContent = msg;
}

function show(id, display) {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
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
  show('loading-state', 'none');

  // Gauge
  show('gauge-wrap', 'block');
  const { score } = data;
  const color   = getColor(score);
  const verdict = getVerdict(score);

  document.getElementById('gauge-score').textContent   = score + '%';
  document.getElementById('gauge-score').style.color   = color;
  document.getElementById('gauge-verdict').textContent  = verdict.label;
  document.getElementById('gauge-verdict').style.color  = verdict.color;
  document.getElementById('gauge-fill').style.width     = score + '%';
  document.getElementById('gauge-fill').style.background = color;

  // Indicators
  show('indicators', 'flex');
  const indList = document.getElementById('ind-list');
  indList.innerHTML = '';

  (data.indicators || []).forEach(ind => {
    const c  = getColor(ind.score);
    const el = document.createElement('div');
    el.className = 'indicator';
    el.innerHTML = `
      <div class="ind-top">
        <div class="ind-name">${escHtml(ind.name)}</div>
        <div class="ind-score-badge" style="background:${c}18;color:${c}">${ind.score}%</div>
      </div>
      <div class="ind-desc">${escHtml(ind.description)}</div>
      <div class="ind-mini-bar">
        <div class="ind-mini-fill" style="width:${ind.score}%;background:${c}"></div>
      </div>`;
    indList.appendChild(el);
  });

  // Analysis
  show('analysis-box', 'block');
  document.getElementById('analysis-text').textContent = data.analysis || '';
}

// ── Análise — chama o backend ─────────────────────────────────────────────────
btnEl.addEventListener('click', async () => {
  const text = txtEl.value.trim();
  if (!text || text.split(/\s+/).length < 20) return;

  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="spin-sm"></span> Analisando...';
  showLoading();

  try {
    const res = await fetch('/api/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }

    showResults(data);

  } catch (err) {
    showLoading('ERRO NA ANÁLISE');
    document.getElementById('loading-msg').textContent = '❌ ' + err.message;
    console.error('[app]', err);
  }

  btnEl.disabled = false;
  btnEl.innerHTML = '🔍 Analisar';
});

// ── Status da API (verifica se o backend está com chave configurada) ──────────
async function checkStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    const dot  = document.getElementById('status-dot');
    const txt  = document.getElementById('status-text');

    if (data.ready) {
      dot.className  = 'status-dot ok';
      txt.className  = 'status-text ok';
      txt.textContent = `API conectada · modelo: ${data.model}`;
    } else {
      dot.className  = 'status-dot err';
      txt.className  = 'status-text err';
      txt.textContent = 'Chave API não configurada — veja o README';
    }
  } catch {
    // servidor ainda não subiu ou sem rota de status
  }
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
resetUI();
checkStatus();
