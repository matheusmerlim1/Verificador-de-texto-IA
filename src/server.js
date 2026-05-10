/**
 * src/server.js
 * Servidor Express — proxy seguro para a API da Anthropic.
 *
 * A chave da API fica no .env (servidor), nunca exposta no frontend.
 * O frontend chama POST /api/analyze e este servidor repassa para Claude.
 */

import 'dotenv/config';
import express      from 'express';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath }  from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC    = join(__dirname, '..', 'public');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const KEY  = process.env.ANTHROPIC_API_KEY;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC));

// ─── GET /api/status ─────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const ready = Boolean(KEY && KEY.startsWith('sk-ant'));
  res.json({ ready, model: ready ? 'claude-sonnet-4-20250514' : null });
});

// ─── POST /api/analyze ───────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  // Valida chave configurada
  if (!KEY || !KEY.startsWith('sk-ant')) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY não configurada no servidor. Copie .env.example para .env e adicione sua chave.'
    });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ error: 'Texto muito curto. Mínimo 50 caracteres.' });
  }

  const prompt = `Você é um especialista em linguística computacional e detecção de texto gerado por IA. Analise o texto abaixo e determine a probabilidade de ter sido escrito por uma IA (como ChatGPT, Claude, Gemini, etc.) versus um humano.

Texto a analisar:
"""
${text.slice(0, 8000)}
"""

Analise estes indicadores específicos:
1. Perplexidade e previsibilidade lexical (vocabulário muito uniforme e "seguro" sugere IA)
2. Variância de comprimento de frases (frases muito uniformes em tamanho sugerem IA)
3. Marcadores de oralidade e informalidade (gírias, contrações, erros leves — sugerem humano)
4. Hedging excessivo e linguagem de disclaimers (muito uso de "é importante notar", "vale ressaltar" — sugere IA)
5. Coerência temática artificial (transições muito suaves e perfeitas — sugerem IA)
6. Expressões de experiência pessoal genuína (anedotas específicas, emoções — sugerem humano)

Responda APENAS com um JSON válido neste formato exato (sem markdown, sem explicações fora do JSON):
{
  "score": <número inteiro de 0 a 100, onde 0=certamente humano, 100=certamente IA>,
  "indicators": [
    {
      "name": "<nome do indicador>",
      "score": <0 a 100>,
      "description": "<explicação de 1-2 frases do que foi observado neste texto>"
    }
  ],
  "analysis": "<parágrafo de análise em português de 3-5 frases explicando os principais sinais>"
}

Os indicators devem ter EXATAMENTE 5 itens com nomes: "Previsibilidade Lexical", "Uniformidade de Frases", "Marcadores de Oralidade", "Hedging e Disclaimers", "Experiência Pessoal".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[Claude API error]', response.status, errBody);
      return res.status(502).json({
        error: `Erro na API da Anthropic: HTTP ${response.status}. Verifique se a chave é válida.`
      });
    }

    const data  = await response.json();
    const raw   = data.content?.[0]?.text?.trim() ?? '';
    const clean = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      console.error('[Parse error] resposta bruta:', raw);
      return res.status(502).json({ error: 'Resposta da IA não pôde ser interpretada. Tente novamente.' });
    }

    res.json(result);

  } catch (err) {
    console.error('[Server error]', err);
    res.status(500).json({ error: 'Erro interno do servidor: ' + err.message });
  }
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(PUBLIC, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const keyOk = KEY && KEY.startsWith('sk-ant');
  console.log(`\n🚀 Detector IA rodando: http://localhost:${PORT}`);
  console.log(`🔑 API Key: ${keyOk ? '✅ configurada' : '❌ AUSENTE — copie .env.example para .env'}\n`);
});
