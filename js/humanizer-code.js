/**
 * humanizer-code.js — Reescrita de código para reduzir o percentual de IA
 *
 * O modo "Código" analisa e descreve o que mudar, mas não reescreve: o prompt de
 * análise termina com "NÃO reescreva o arquivo". Este módulo é quem reescreve,
 * usando a análise daquele arquivo como pauta — os sinais encontrados, os trechos
 * suspeitos e as sugestões já produzidas.
 *
 * O catálogo abaixo é de código, não de prosa. A skill `avoid-ai-writing` que o
 * projeto embute declara a própria limitação: "Does not detect AI-generated code,
 * only prose". Os padrões daqui saem da análise do modo código (js/code.js) e do
 * que a heurística local (js/heuristics.js) já mede.
 *
 * GARANTIA DE SOMENTE LEITURA — mantida
 * ─────────────────────────────────────
 * Nada é gravado sobre o projeto analisado. O arquivo original é lido de novo em
 * memória, a versão reescrita aparece na tela para copiar ou baixar, e quem decide
 * o que fazer com ela é a pessoa.
 *
 * GARANTIA DE COMPORTAMENTO
 * ─────────────────────────
 * Humanizar é mudar a superfície, nunca o que o código faz. O prompt proíbe
 * alterar lógica, assinatura pública, dependências e mensagens de erro que alguém
 * possa estar casando por texto. Mesmo assim: código reescrito por modelo precisa
 * passar pelos testes do projeto antes de entrar. A tela diz isso.
 */

'use strict';

/**
 * O que denuncia código gerado, e o que fazer a respeito.
 *
 * `peso` é o quanto o sinal costuma pesar na pontuação — serve para ordenar a
 * pauta da reescrita, não para pontuar de novo (quem pontua é js/code.js).
 * `corrige` é a instrução que vai para o prompt.
 */
const CODE_TELLS = [
  {
    id: 'comentario-obvio',
    peso: 'alto',
    nome: 'Comentário que repete o código',
    sinal: 'Comentários que narram a linha seguinte sem acrescentar nada ("// incrementa o contador", "// retorna o resultado").',
    corrige: 'Apague. Comentário só fica quando explica uma decisão, uma restrição externa ou um porquê que o código não mostra.'
  },
  {
    id: 'nome-generico',
    peso: 'alto',
    nome: 'Nome genérico',
    sinal: 'data, result, temp, item, value, obj, handleClick, processData, utils, helper, manager.',
    corrige: 'Troque pelo vocabulário do problema. Quem lê o nome tem que saber do que se trata sem abrir a função.'
  },
  {
    id: 'estrutura-uniforme',
    peso: 'alto',
    nome: 'Uniformidade sem motivo',
    sinal: 'Toda função com o mesmo formato de cabeçalho, o mesmo tamanho, a mesma ordem de seções. Nenhuma função destoa.',
    corrige: 'Código humano é desigual: a parte difícil recebe mais atenção e mais linhas que a trivial. Deixe a assimetria aparecer.'
  },
  {
    id: 'erro-cerimonial',
    peso: 'alto',
    nome: 'Tratamento de erro cerimonial',
    sinal: 'try/catch que só registra e relança; validação de parâmetro que o chamador já garante; erro genérico onde o caso é conhecido.',
    corrige: 'Trate o erro que realmente acontece naquele ponto, ou deixe subir. Não envolva tudo em try/catch por precaução.'
  },
  {
    id: 'secao-decorativa',
    peso: 'medio',
    nome: 'Divisória decorativa repetida',
    sinal: 'Faixas de =====, ------ ou ★★★ separando cada seção, sempre do mesmo tamanho.',
    corrige: 'Mantenha no máximo onde a divisão ajuda a navegar um arquivo longo. Não em toda função.'
  },
  {
    id: 'abstracao-prematura',
    peso: 'medio',
    nome: 'Abstração prematura',
    sinal: 'Função auxiliar de uma linha usada uma vez; camada de indireção que não serve a nada ainda.',
    corrige: 'Traga de volta para onde é usada. Abstração se justifica pelo segundo uso, não pelo primeiro.'
  },
  {
    id: 'sem-rastro',
    peso: 'medio',
    nome: 'Ausência de rastro de trabalho',
    sinal: 'Nenhum TODO, nenhuma limitação assumida, nenhuma referência a decisão, ticket ou caso real.',
    corrige: 'Se existe uma pendência, escreva-a. Se uma escolha foi um meio-termo, registre o porquê. É o que código de gente tem.'
  },
  {
    id: 'defensivo-demais',
    peso: 'medio',
    nome: 'Defensividade fora de contexto',
    sinal: 'Checagem de nulo em valor que nunca é nulo; default para caso impossível; comentário garantindo o óbvio.',
    corrige: 'Remova a checagem que não pode disparar. Ela só engorda o arquivo e esconde a que importa.'
  },
  {
    id: 'docstring-de-molde',
    peso: 'medio',
    nome: 'Cabeçalho de molde',
    sinal: 'Docstring que lista @param e @returns repetindo os nomes, sem dizer nada sobre uso, unidade ou limite.',
    corrige: 'Diga a unidade, a faixa válida, o que acontece no limite. Se não há o que dizer, não escreva o cabeçalho.'
  },
  {
    id: 'exemplo-de-manual',
    peso: 'baixo',
    nome: 'Sobra de exemplo',
    sinal: 'foo, bar, baz, example.com, "Lorem ipsum", TODO genérico, valores 123 / "teste".',
    corrige: 'Troque por dado do domínio real do projeto.'
  }
];

/** Os padrões em texto, para o prompt e para a tela. */
function codeTellCatalog() {
  return CODE_TELLS.map(t =>
    `[${t.peso}] ${t.nome}\n  sinal: ${t.sinal}\n  correção: ${t.corrige}`).join('\n\n');
}

/**
 * Monta o pedido de reescrita de um arquivo.
 *
 * @param {object} file     entrada de CodeState.files ({ path, name, lang, ... })
 * @param {string} content  o conteúdo do arquivo, lido de novo na hora
 * @param {object} result   o resultado da análise daquele arquivo (buildFileResult)
 * @param {object} opts     { intensidade: 'conservadora'|'padrao'|'profunda' }
 */
function buildHumanizeCodePrompt(file, content, result, opts = {}) {
  const intensidade = opts.intensidade || 'padrao';

  const pauta = [];
  (result.signals || []).forEach(s =>
    pauta.push(`- sinal detectado: ${s.name}${s.evidence ? ` — ${s.evidence}` : ''}`));
  (result.hotspots || []).forEach(h =>
    pauta.push(`- trecho suspeito (linhas ${h.lines}): ${h.why}`));
  (result.suggestions || []).forEach(s =>
    pauta.push(`- já sugerido: ${s.action}${s.where ? ` (${s.where})` : ''}`));

  const limite = {
    conservadora: 'Mexa só em comentários e em nomes de variáveis e funções LOCAIS. Não mude a organização do arquivo.',
    padrao:       'Mexa em comentários, nomes locais, organização interna das funções e tratamento de erro cerimonial.',
    profunda:     'Além do anterior, pode desfazer abstração prematura e reorganizar a ordem das funções do arquivo.'
  }[intensidade];

  return `Você reescreve código para que ele deixe de parecer gerado por modelo, sem mudar o que ele faz.

ARQUIVO: ${file.path}
LINGUAGEM: ${file.lang || 'indefinida'}
PERCENTUAL DE IA MEDIDO: ${result.score}%

PAUTA DESTA REESCRITA — o que a análise encontrou neste arquivo:
${pauta.length ? pauta.join('\n') : '- nenhum sinal específico; aplique o catálogo geral'}

CATÁLOGO DE PADRÕES DE CÓDIGO GERADO:
${codeTellCatalog()}

ALCANCE DESTA REESCRITA (${intensidade}): ${limite}

PROIBIÇÕES — quebrar qualquer uma destas invalida a resposta:
1. NÃO altere o comportamento. Mesma entrada, mesma saída, mesmos efeitos colaterais.
2. NÃO renomeie nada exportado, público ou referenciado de fora: função exportada, classe, método público, chave de objeto de configuração, id ou classe de CSS, nome de evento, rota, campo de JSON.
3. NÃO acrescente nem remova dependência, import ou pacote.
4. NÃO mude texto de mensagem de erro, log ou string que outro código possa comparar.
5. NÃO remova tratamento de erro que trata um caso real; só o que é cerimônia (capturar para relançar igual, validar o que já é garantido).
6. NÃO invente TODO, ticket, nome de pessoa ou histórico que você não tem como saber. Se o arquivo não tem rastro de iteração, deixe sem — inventar é pior que a ausência.
7. NÃO traduza o código nem os identificadores para outro idioma.
8. Mantenha o estilo de formatação do projeto (aspas, ponto e vírgula, indentação, largura de linha).

O QUE FAZER:
- Nomes locais que digam o que a coisa é no domínio do problema.
- Comentário só onde explica um porquê, uma restrição ou uma decisão. O resto sai.
- Deixe o arquivo desigual: a parte difícil merece mais explicação que a trivial.
- Tratamento de erro à altura do que de fato pode falhar ali.

CÓDIGO ORIGINAL:
\`\`\`${file.lang || ''}
${content}
\`\`\`

Responda APENAS com JSON válido, sem markdown e sem texto fora do JSON:
{
  "rewritten": "<o arquivo inteiro reescrito, do começo ao fim, com as quebras de linha preservadas>",
  "changes": [
    { "what": "<o que mudou, concreto>", "why": "<que sinal isso elimina>", "where": "<função ou linhas>" }
  ],
  "kept": [ "<o que você deliberadamente NÃO mudou, e por quê>" ],
  "risk": "<nenhum|baixo|medio|alto: risco de ter alterado comportamento sem querer>",
  "note": "<uma frase sobre o que ainda denuncia geração, se sobrou algo>"
}

"rewritten" tem que ser o arquivo completo e válido na linguagem — não um trecho, não um diff, não um resumo.`;
}
