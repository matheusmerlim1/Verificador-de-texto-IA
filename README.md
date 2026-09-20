# Detector de Autoria por IA — Versão Estática

Ferramenta para estimar autoria por IA em dois formatos:

1. **Texto** — analisa um texto colado e, se desejado, **reescreve** para reduzir
   os marcadores de geração automática.
2. **Projeto de código** — recebe uma **pasta inteira**, analisa arquivo por arquivo
   e gera um **relatório** com o percentual por documento e o que alterar.

**Versão 100% estática** — sem servidor, sem backend, sem build.
Funciona em qualquer hospedagem de arquivos estáticos.

---

## Diferença fundamental entre os dois modos

| | Modo Texto | Modo Código |
|---|---|---|
| Entrada | texto colado | pasta do projeto |
| Saída | pontuação + análise | relatório por documento |
| Reescrita | **sim** — gera versão revisada | **não** — apenas sugestões |
| Arquivos alterados | nenhum | **nenhum** |

O código analisado **nunca é reescrito**. Os arquivos são lidos em memória pelo
navegador (`FileReader`), avaliados e descartados. A ferramenta não tem permissão
de escrita: a única saída é o relatório, que você baixa separadamente.

---

## Arquivos

```
detector-ia/
├── index.html
├── config.js                    ← chave de API (vazio = cada usuário informa a sua)
├── css/
│   └── style.css                ← estilos, inclui folha de impressão/PDF
├── js/
│   ├── core.js                  ← chave, chamada ao Claude, helpers, abas
│   ├── forensics.js             ← rastros técnicos (offline, determinístico)
│   ├── humanizer.js             ← 25 padrões e prompt de reescrita
│   ├── heuristics.js            ← análise estática de código (offline)
│   ├── app.js                   ← modo Texto
│   ├── code.js                  ← modo Código
│   └── report.js                ← relatório e exportação
├── vendor/
│   └── avoid-ai-writing/        ← motor de detecção em inglês (MIT)
├── skills/
│   └── humanizer/               ← skill original em Markdown (MIT)
└── .githooks/pre-commit         ← bloqueia commit que contenha chave
```

A ordem das tags `<script>` importa: `config.js` → `patterns.js` → `core.js` → o resto.

---

## Como usar

Online: https://matheusmerlim1.github.io/Verificador-de-texto-IA/

Cada visitante informa a própria chave da Anthropic, que fica salva apenas no
`localStorage` do navegador dele.

Para rodar local:

```bash
python3 -m http.server 8080   # ou:  npx serve .
# Acesse: http://localhost:8080
```

**Não funciona via `file://`** — o navegador bloqueia por CORS.

---

## Modo Texto

1. Cole o texto (mínimo de 20 palavras; 100+ dá resultado mais estável).
2. **Analisar** → pontuação de 0 a 100, cinco indicadores linguísticos,
   análise em prosa e sugestões concretas de alteração.
3. **Reescrever para reduzir IA** → gera uma versão revisada, escolhendo o registro
   (original, acadêmico, profissional ou coloquial).
4. **Usar e reanalisar** → substitui o texto e roda a análise de novo, mostrando
   a variação em pontos em relação à medição anterior.

A reescrita preserva conteúdo factual, números e citações, e **não inventa**
dados ou experiências pessoais. Pontos vagos que não puderam ser tornados
concretos sem invenção são listados como "pontos que exigem sua revisão".

---

## Modo Projeto de código

1. Arraste a pasta do projeto (ou use **Escolher pasta**).
2. A ferramenta filtra automaticamente o que não é autoria de código:
   `node_modules`, `.git`, `dist`, `build`, `venv`, `__pycache__`, arquivos
   minificados, lockfiles, binários e arquivos acima de 400 KB.
3. Ajuste a seleção nas caixas de marcação (controla custo e escopo).
4. **Analisar** → cada arquivo passa por duas avaliações independentes.
5. Exporte o relatório em **Markdown**, **CSV**, **JSON** ou **PDF** (impressão).

### Como a pontuação é calculada

Cada arquivo recebe duas notas:

- **Heurística local** (`heuristics.js`) — dez sinais estáticos, calculados no
  navegador, sem rede: densidade de comentários, comentários redundantes,
  fraseologia de LLM, ausência de marcas de autoria (TODO, gambiarra, link),
  uniformidade estrutural, nomes genéricos, tratamento de erro cerimonial,
  banners decorativos, documentação exaustiva e ausência de código morto.
- **Semântica** — avaliação do Claude, que recebe o código e as heurísticas
  já calculadas como evidência.

A nota final é `0,7 × semântica + 0,3 × heurística`. O percentual do projeto é
a **média ponderada por linhas de código** — um arquivo de 500 linhas pesa mais
que um de 10.

**Sem chave de API**, o modo código continua funcionando apenas com a heurística
local: gratuito, offline e mais grosseiro.

### O que o relatório traz

- Percentual consolidado do projeto e média simples por arquivo.
- Distribuição dos arquivos em três faixas.
- Tabela de percentual por documento, com LOC e confiança.
- Ações prioritárias do projeto, agrupadas por quantas vezes se repetem.
- Por arquivo: sinais com evidência, trechos mais suspeitos com intervalo de
  linhas, e a lista de alterações recomendadas com impacto e esforço.

---

## Chave da API — duas versões

O arquivo `config.js` decide o comportamento, e é a única diferença entre as
duas cópias do projeto.

| | Versão pública (esta) | Versão privada |
|---|---|---|
| `config.js` | `apiKey: ''` | `apiKey: 'sk-ant-...'` |
| Quem paga | cada visitante | o dono da chave |
| Barra de chave | visível | escondida |
| Pode ir para a web | sim | **não** |

Na versão pública, a chave fica no `localStorage` do próprio visitante e não
passa por nenhum servidor além da API da Anthropic.

### Por que a versão com chave não pode ser publicada

Este é um site estático: `config.js` é baixado pelo navegador de quem abrir a
página. A chave aparece em "Ver código-fonte". Não há como esconder uma chave
em site estático — ofuscar, dividir em pedaços ou usar base64 não resolve,
porque o navegador precisa do valor final para fazer a requisição.

Repositório privado não protege o site: o GitHub Pages serve a página
publicamente mesmo com o repositório privado. Privado protege o código, não a
página servida.

Por isso o repositório público tem um hook que recusa qualquer commit contendo
`sk-ant-`. Para ativá-lo depois de clonar:

```bash
git config core.hooksPath .githooks
```

Obtenha sua chave em: https://console.anthropic.com/settings/keys

O modelo é selecionável na barra superior:

| Modelo | Quando usar |
|---|---|
| `claude-sonnet-5` | padrão — melhor relação custo/precisão |
| `claude-opus-5` | quando a precisão importa mais que o custo |
| `claude-haiku-4-5` | projetos grandes, triagem rápida |

**Custo:** o modo código faz **uma requisição por arquivo selecionado**
(3 em paralelo). Em projetos grandes, use a seleção de arquivos ou o Haiku.

---

## Deploy no GitHub Pages

1. **Settings → Pages → Deploy from branch → main**.
2. Acesse `https://seu-usuario.github.io/nome-do-repo`.

Antes de publicar, confirme que `config.js` tem `apiKey: ''`. O hook em
`.githooks/pre-commit` recusa o commit se encontrar uma chave, mas ele só roda
depois de `git config core.hooksPath .githooks`.

---

## Limitações

Nenhum detector de autoria é conclusivo, e isso vale nos dois modos.

Em código, o problema é mais severo que em texto: código idiomático, formatado
por linter, seguindo o padrão de uma equipe ou resolvendo um problema comum
tende a convergir para a mesma forma independentemente de quem escreveu.
Boilerplate de framework, arquivos de configuração e CRUD repetitivo pontuam
alto por natureza.

Trate o resultado como **indício para investigação**, nunca como prova.

Reduzir o percentual não altera a autoria real do trabalho. As sugestões do
relatório apontam para código mais específico do domínio, mais legível e com
rastro de decisão — benefícios válidos independentemente da questão de autoria.

---

## Indicadores — modo Texto

| Indicador | Sinal |
|---|---|
| Previsibilidade Lexical | Vocabulário uniforme → IA |
| Uniformidade de Frases | Comprimento homogêneo → IA |
| Marcadores de Oralidade | Gírias, erros leves → Humano |
| Hedging e Disclaimers | "é importante notar" → IA |
| Experiência Pessoal | Contexto situado → Humano |

## Indicadores — modo Código

| Indicador | Sinal |
|---|---|
| Densidade de comentários | 20–40% e constante → IA |
| Comentários redundantes | Comentário repete a linha seguinte → IA |
| Fraseologia de LLM | "Args/Returns", "This function handles" → IA |
| Ausência de marcas de autoria | Sem TODO, dúvida ou link → IA |
| Uniformidade estrutural | Baixa variação de linha → IA |
| Nomes genéricos | `data`, `result`, `handler` → IA |
| Tratamento de erro genérico | `except Exception` cerimonial → IA |
| Decoração de seções | Banners e emojis → IA |
| Documentação exaustiva | Docstring em toda função → IA |
| Ausência de código morto | Sem rastro de tentativa e erro → IA |


---

## Detecção de rastros

Além da análise linguística, a ferramenta procura vestígios materiais —
coisas que ou estão no arquivo, ou não estão, sem julgamento estatístico.
Roda local, sem API e sem custo.

| Família | O que procura | Força |
|---|---|---|
| Procedência declarada | `Co-Authored-By: Claude`, `Generated with Claude Code`, trailer do Copilot, `@generated`, `utm_source=chatgpt`, marcação de citação vazada | conclusiva |
| Caracteres invisíveis | ZWSP, ZWNJ, ZWJ, juntador de palavra, hífen suave, marcas de direção, caracteres de tag | conclusiva a partir de 3 |
| Homóglifos | letras cirílicas e gregas sósias de latinas, usadas para furar detector de string exata | conclusiva a partir de 3 |
| Assinatura tipográfica | travessão, meia-risca, aspas curvas, reticências de um caractere, espaço sem quebra | forte em código, fraca em prosa |
| Vocabulário | fórmulas sobre-representadas em saída de LLM, em português e inglês | corroborativa |

A distinção entre código e prosa importa. Em prosa, travessão e aspas curvas
são fracos: Word e Google Docs autocorrigem para eles. Em código são fortes:
nenhum editor de código autocorrige, e quem digita produz `-` e `"`. Por isso
a varredura em modo código recorta apenas comentários e strings, e pesa esses
sinais três vezes mais.

Rastro material não entra na média ponderada — ele a substitui. Um arquivo
assinado `Co-Authored-By: Claude` não é "72% de IA": é certeza declarada.

**A ausência de rastro não prova autoria humana.** Prova apenas que não há
vestígio material.

---

## Créditos

Este projeto incorpora duas skills de terceiros, ambas MIT:

- **[humanizer](https://github.com/blader/humanizer)** — Siqi Chen.
  As 25 regras de reescrita e o fluxo de quatro etapas (marcar, rascunhar,
  conferir, versão final). Texto integral em `skills/humanizer/SKILL.md`;
  porte para o navegador e adaptação ao português em `js/humanizer.js`.

- **[avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing)** —
  Conor Bronsdon. Motor de detecção em JavaScript, usado como está em
  `vendor/avoid-ai-writing/patterns.js`. Cobre inglês; o português é tratado
  por `js/forensics.js`.

Os padrões de ambas remontam a
["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
mantido pelo WikiProject AI Cleanup da Wikipédia.
