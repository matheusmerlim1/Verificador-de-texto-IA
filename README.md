# Detector de Texto IA

Ferramenta web para detectar se um texto foi escrito por IA ou por humano,
usando análise linguística via Claude (Anthropic).

## Como funciona

O frontend envia o texto para um servidor Node.js local (`/api/analyze`).
O servidor repassa para a API da Anthropic com a chave guardada no `.env` —
a chave **nunca fica exposta no navegador**.

## Estrutura

```
detector-ia/
├── public/
│   ├── index.html      ← HTML puro, sem lógica
│   ├── css/
│   │   └── style.css   ← Toda a estilização
│   └── js/
│       └── app.js      ← Lógica do cliente (chama /api/analyze)
├── src/
│   └── server.js       ← Servidor Express + proxy para a API
├── .env.example        ← Modelo de configuração
├── .gitignore
└── package.json
```

## Instalação e uso

### 1. Clone e instale

```bash
git clone https://github.com/seu-usuario/detector-ia.git
cd detector-ia
npm install
```

### 2. Configure a chave da API

```bash
cp .env.example .env
```

Edite o `.env` e adicione sua chave:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Obtenha sua chave em [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).

### 3. Inicie o servidor

```bash
npm start
```

Acesse em [http://localhost:3000](http://localhost:3000).

### Modo desenvolvimento (auto-reload)

```bash
npm run dev
```

## Deploy (opcional)

Para subir em produção, qualquer plataforma que suporte Node.js funciona:
**Railway, Render, Fly.io, VPS**.

Defina a variável de ambiente `ANTHROPIC_API_KEY` no painel da plataforma —
nunca commite o `.env` real no repositório.

## Indicadores analisados

| Indicador | O que detecta |
|---|---|
| Previsibilidade Lexical | Vocabulário muito uniforme e "seguro" → IA |
| Uniformidade de Frases | Comprimento de frases muito homogêneo → IA |
| Marcadores de Oralidade | Gírias, contrações, erros leves → Humano |
| Hedging e Disclaimers | Excesso de "é importante notar" → IA |
| Experiência Pessoal | Anedotas específicas, emoções genuínas → Humano |

## Observação

Nenhum detector é 100% preciso. Use como referência complementar.
