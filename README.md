# Detector de Texto IA — Versão Estática

Ferramenta para detectar se um texto foi escrito por IA ou humano,
usando análise linguística via Claude (Anthropic).

**Versão 100% estática** — sem servidor, sem backend.
Funciona em qualquer hospedagem de arquivos estáticos.

## Arquivos

```
detector-ia/
├── index.html   ← Estrutura HTML
├── style.css    ← Estilos
├── app.js       ← Toda a lógica (chamada à API, UI)
└── README.md
```

## Como usar localmente

Basta abrir o `index.html` em qualquer servidor HTTP local.
**Não funciona via `file://`** por restrições de CORS do browser.

```bash
# Com Python
python3 -m http.server 8080

# Com Node.js (npx)
npx serve .

# Acesse: http://localhost:8080
```

## Deploy no GitHub Pages

1. Crie um repositório no GitHub
2. Faça upload dos três arquivos (`index.html`, `style.css`, `app.js`)
3. Vá em **Settings → Pages → Deploy from branch → main**
4. Acesse: `https://seu-usuario.github.io/nome-do-repo`

## Chave da API

A chave é inserida pelo usuário diretamente na interface e salva
no `localStorage` do navegador — não vai para nenhum servidor externo.

Obtenha sua chave em: https://console.anthropic.com/settings/keys

## Indicadores analisados

| Indicador | Sinal |
|---|---|
| Previsibilidade Lexical | Vocabulário uniforme → IA |
| Uniformidade de Frases | Comprimento homogêneo → IA |
| Marcadores de Oralidade | Gírias, erros leves → Humano |
| Hedging e Disclaimers | "é importante notar" → IA |
| Experiência Pessoal | Contexto situado → Humano |
