/*
 * test-metodos.js — um teste para cada método da página.
 *
 * Carrega a página num Chrome sem janela e exercita, uma a uma, as funções de cada módulo:
 * core, forensics, heuristics, humanizer, humanizer-code, zip, code e report. As que dependem
 * da API são testadas com a chamada trocada por uma resposta controlada — nada é gasto.
 *
 * Uso: node tools/test-metodos.js [caminho do projeto]
 * Precisa do Chrome instalado.
 */
'use strict';

const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = process.argv[2] || process.cwd();
const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "p1m-"));
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
    ["--headless=new", "--disable-gpu", "--allow-file-access-from-files",
     "--remote-debugging-port=9390", `--user-data-dir=${perfil}`, "--window-size=1440,1000", "about:blank"],
    { stdio: "ignore" });

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(250);
    try { alvo = (await (await fetch("http://127.0.0.1:9390/json/list")).json()).find(t => t.type === "page"); } catch (e) {}
  }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const erros = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown")
      erros.push(String((m.params.exceptionDetails.exception || {}).description).split("\n")[0]);
  });
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const rodar = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails)
      throw new Error(String((r.result.exceptionDetails.exception || {}).description).split("\n")[0]);
    return r.result.result.value;
  };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: encodeURI("file:///" + RAIZ.replace(/\\/g, "/") + "/index.html") });
  await esperar(1800);

// A chave é de mentira e é montada em pedaços de propósito: o hook do repositório
// barra qualquer 'sk-' + 'ant-' literal no código, e ele está certo em barrar.
  const ok = [], falhas = [];
  /** Cada teste diz qual método cobre, para a saída servir de inventário. */
  const metodo = async (modulo, nome, fn) => {
    const rotulo = `${modulo}.${nome}`;
    try { const r = await fn(); if (r === false) falhas.push(rotulo); else ok.push(rotulo); }
    catch (e) { falhas.push(rotulo + " — " + String(e.message).split("\n")[0]); }
  };
  /** Avalia uma expressão e devolve o JSON. O await cobre o caso de a expressão
      ser assíncrona: sem ele, JSON.stringify de uma Promise devolve "{}". */
  const val = async expr =>
    JSON.parse(await rodar(`(async () => JSON.stringify(await (${expr})))()`));

  // ════════════════════════════════════════════════
  //  core.js
  // ════════════════════════════════════════════════
  await metodo("core", "escHtml", async () => {
    const r = await rodar(`escHtml('<a href="x">&</a>')`);
    if (/[<>]/.test(r)) throw new Error("não escapou: " + r);
    if (!r.includes("&amp;")) throw new Error("não escapou o &: " + r);
    return true;
  });

  await metodo("core", "countWords", async () => {
    const r = await val(`[countWords("uma duas três"), countWords("  "), countWords("a\\n\\nb")]`);
    if (r[0] !== 3) throw new Error("3 palavras viraram " + r[0]);
    if (r[1] !== 0) throw new Error("espaço em branco virou " + r[1]);
    if (r[2] !== 2) throw new Error("quebra de linha: " + r[2]);
    return true;
  });

  await metodo("core", "fmtBytes", async () => {
    const r = await val(`[fmtBytes(0), fmtBytes(900), fmtBytes(2048), fmtBytes(1048576)]`);
    if (!/B/.test(r[1])) throw new Error("bytes sem unidade: " + r[1]);
    if (!/KB/i.test(r[2])) throw new Error("2048 devia virar KB: " + r[2]);
    if (!/MB/i.test(r[3])) throw new Error("1 MB: " + r[3]);
    return true;
  });

  await metodo("core", "getColor", async () => {
    const r = await val(`[getColor(5), getColor(50), getColor(95)]`);
    if (new Set(r).size < 2) throw new Error("mesma cor para 5%, 50% e 95%: " + r.join(", "));
    for (const c of r) if (!/^#|rgb|var/.test(c)) throw new Error("cor estranha: " + c);
    return true;
  });

  await metodo("core", "getVerdict", async () => {
    const r = await val(`[getVerdict(5), getVerdict(95)]`);
    if (!r[0] || !r[1]) throw new Error("veredito vazio");
    if (r[0] === r[1]) throw new Error("mesmo veredito para 5% e 95%: " + r[0]);
    return true;
  });

  await metodo("core", "parseJSON", async () => {
    const limpo = await val(`parseJSON('{"a":1}')`);
    if (limpo.a !== 1) throw new Error("JSON simples falhou");
    const cercado = await val("parseJSON('```json\\n{\"b\":2}\\n```')");
    if (cercado.b !== 2) throw new Error("não removeu a cerca de markdown");
    return true;
  });

  await metodo("core", "show / hide", async () => {
    const r = await val(`(() => {
      const el = document.getElementById('report');
      hide('report'); const d1 = getComputedStyle(el).display;
      show('report', 'flex'); const d2 = getComputedStyle(el).display;
      hide('report');
      return [d1, d2];
    })()`);
    if (r[0] !== "none") throw new Error("hide não escondeu: " + r[0]);
    if (r[1] !== "flex") throw new Error("show não mostrou como flex: " + r[1]);
    return true;
  });

  await metodo("core", "runPool", async () => {
    const r = await val(`(async () => {
      let simultaneos = 0, pico = 0;
      const res = await runPool([1, 2, 3, 4, 5, 6], 2, async (n, i) => {
        simultaneos++; pico = Math.max(pico, simultaneos);
        await new Promise(r => setTimeout(r, 40));
        simultaneos--; return n * 10 + i;
      });
      return { itens: res.length, pico, ordem: res.join(",") };
    })()`);
    if (r.itens !== 6) throw new Error("devolveu " + r.itens + " de 6");
    if (r.pico > 2) throw new Error("passou do limite de 2 simultâneos: " + r.pico);
    // o resultado tem que voltar na ordem da entrada, não na ordem em que terminou
    if (r.ordem !== "10,21,32,43,54,65") throw new Error("fora de ordem: " + r.ordem);
    return true;
  });

  await metodo("core", "callClaude / callClaudeJSON", async () => {
    // o header do workspace só vai quando o campo está preenchido
    const r = await val(`(async () => {
      const original = window.fetch;
      let visto = null;
      window.fetch = async (url, opts) => { visto = opts.headers;
        return { ok: true, json: async () => ({ content: [{ text: '{"x":1}' }] }) }; };
      App.apiKey = ['sk', 'ant', 'api03-teste'].join('-'); App.workspaceId = '';
      await callClaudeJSON('oi');
      const sem = !!visto['anthropic-workspace-id'];
      App.workspaceId = 'wrkspc_abc';
      const dados = await callClaudeJSON('oi');
      const com = visto['anthropic-workspace-id'];
      App.workspaceId = ''; window.fetch = original;
      return { sem, com, dados };
    })()`);
    if (r.sem) throw new Error("mandou o header de workspace sem o campo preenchido");
    if (r.com !== "wrkspc_abc") throw new Error("não mandou o workspace: " + r.com);
    if (r.dados.x !== 1) throw new Error("não devolveu o JSON da resposta");
    return true;
  });

  // ════════════════════════════════════════════════
  //  forensics.js
  // ════════════════════════════════════════════════
  await metodo("forensics", "stripInvisible", async () => {
    const r = await val(`(() => {
      const sujo = "a\\u200bb\\u00adc\\u2060d";
      const limpo = stripInvisible(sujo);
      return { antes: sujo.length, depois: limpo.length, texto: limpo };
    })()`);
    if (r.texto !== "abcd") throw new Error("sobrou caractere invisível: " + JSON.stringify(r.texto));
    return true;
  });

  await metodo("forensics", "runForensics", async () => {
    const r = await val(`runForensics("Texto normal, sem rastro nenhum.", { mode: 'text' })`);
    if (!Array.isArray(r.traces)) throw new Error("sem a lista de rastros");
    const sujo = await val(`runForensics("a\\u200bb Co-Authored-By: Claude", { mode: 'code' })`);
    if (!sujo.traces.length) throw new Error("não achou rastro em texto assinado");
    if (!sujo.conclusive) throw new Error("assinatura do Claude devia ser conclusiva");
    return true;
  });

  // ════════════════════════════════════════════════
  //  heuristics.js
  // ════════════════════════════════════════════════
  await metodo("heuristics", "extOf / langOf", async () => {
    const r = await val(`[extOf("a/b/c.TS"), langOf("x/y.php"), langOf("z.desconhecido")]`);
    if (r[0] !== "ts") throw new Error("extensão: " + r[0]);
    if (!/php/i.test(r[1])) throw new Error("linguagem: " + r[1]);
    if (!r[2]) throw new Error("linguagem desconhecida devia ter um rótulo");
    return true;
  });

  await metodo("heuristics", "shouldAnalyze", async () => {
    const r = await val(`["src/a.js:1000", "node_modules/x/a.js:1000", "a.png:1000",
      "src/a.js:99999999", "src/a.js:0", ".env:100"].map(c => {
        const i = c.lastIndexOf(":");
        return shouldAnalyze(c.slice(0, i), Number(c.slice(i + 1)));
      })`);
    if (!r[0].ok) throw new Error("recusou um .js comum: " + r[0].reason);
    if (r[1].ok) throw new Error("aceitou node_modules");
    if (r[2].ok) throw new Error("aceitou uma imagem");
    if (r[3].ok) throw new Error("aceitou arquivo gigante");
    if (r[4].ok) throw new Error("aceitou arquivo vazio");
    if (r[5].ok) throw new Error("aceitou arquivo oculto");
    for (let i = 1; i < r.length; i++)
      if (!r[i].reason) throw new Error("recusou sem dizer o motivo: item " + i);
    return true;
  });

  await metodo("heuristics", "commentPrefix", async () => {
    const r = await val(`[commentPrefix("py"), commentPrefix("js"), commentPrefix("php")]`);
    if (r[0] !== "#") throw new Error("python: " + r[0]);
    if (!String(r[1]).includes("/")) throw new Error("js: " + r[1]);
    return true;
  });

  await metodo("heuristics", "classifyLines", async () => {
    const r = await val(`classifyLines(["// nota", "const a = 1;", "", "  // outra"], "js")`);
    if (!r || typeof r !== "object") throw new Error("não devolveu a classificação");
    const total = (r.comment ?? r.comments ?? 0) + (r.code ?? 0) + (r.blank ?? r.blanks ?? 0);
    if (total < 3) throw new Error("classificou " + total + " de 4 linhas: " + JSON.stringify(r));
    return true;
  });

  await metodo("heuristics", "stdev", async () => {
    const r = await val(`[stdev([2,2,2,2]), Math.round(stdev([1,5]) * 100) / 100]`);
    if (r[0] !== 0) throw new Error("desvio de valores iguais devia ser 0: " + r[0]);
    if (!(r[1] > 0)) throw new Error("desvio de [1,5] devia ser > 0: " + r[1]);
    return true;
  });

  await metodo("heuristics", "analyzeHeuristics", async () => {
    const autoral = ["function preco(p) {", "  // TODO: faixa de desconto ainda não fechada",
      "  return p * 0.9;", "}"].join(String.fromCharCode(10));
    const gerado = Array.from({ length: 12 }, (_, i) =>
      ["/**", " * Processa os dados.", " * @param {Object} data Os dados.", " * @returns {Object} O resultado.",
       " */", `function processData${i}(data) {`, "  // retorna o resultado", "  const result = data;",
       "  return result;", "}"].join(String.fromCharCode(10))).join(String.fromCharCode(10));
    const r = await val(`(() => {
      const a = analyzeHeuristics(${JSON.stringify(autoral)}, "a.js");
      const g = analyzeHeuristics(${JSON.stringify(gerado)}, "g.js");
      return { autoral: a.score, gerado: g.score, temStats: !!a.stats, sinais: g.signals.length };
    })()`);
    if (r.gerado <= r.autoral)
      throw new Error(`código de molde (${r.gerado}%) devia pontuar mais que o autoral (${r.autoral}%)`);
    if (!r.temStats) throw new Error("não devolveu estatísticas");
    if (!r.sinais) throw new Error("não listou nenhum sinal no código de molde");
    return true;
  });

  await metodo("heuristics", "heuristicsBrief", async () => {
    const r = await rodar(`heuristicsBrief(analyzeHeuristics("const a = 1;", "a.js"))`);
    if (!r || typeof r !== "string") throw new Error("o resumo devia ser texto");
    return true;
  });

  // ════════════════════════════════════════════════
  //  humanizer.js (texto)
  // ════════════════════════════════════════════════
  await metodo("humanizer", "patternCatalog", async () => {
    const r = await rodar(`patternCatalog()`);
    if (!r || r.length < 200) throw new Error("catálogo curto demais: " + (r || "").length);
    return true;
  });

  await metodo("humanizer", "buildHumanizePrompt", async () => {
    const p = await rodar(`buildHumanizePrompt("Um texto qualquer.", "tecnico",
      runForensics("Um texto qualquer.", { mode: 'text' }),
      "Escrevo assim: frase curta, vírgula no lugar certo, e nada de floreio para encher.")`);
    if (!p.includes("Um texto qualquer.")) throw new Error("o texto não entrou no prompt");
    if (!p.includes("nada de floreio")) throw new Error("a amostra de voz não entrou");
    // uma amostra curta não dá para imitar voz nenhuma, então é para ser ignorada
    const sem = await rodar(`buildHumanizePrompt("Um texto.", "tecnico", null, "marcador-zzq")`);
    if (sem.includes("marcador-zzq")) throw new Error("usou uma amostra curta demais como voz");
    if (!/rewritten/.test(p)) throw new Error("não pediu o campo rewritten");
    return true;
  });

  // ════════════════════════════════════════════════
  //  humanizer-code.js
  // ════════════════════════════════════════════════
  await metodo("humanizer-code", "codeTellCatalog", async () => {
    const r = await rodar(`codeTellCatalog()`);
    for (const t of ["Comentário que repete o código", "Nome genérico", "correção:"])
      if (!r.includes(t)) throw new Error("faltou no catálogo: " + t);
    return true;
  });

  await metodo("humanizer-code", "buildHumanizeCodePrompt", async () => {
    const p = await rodar(`buildHumanizeCodePrompt(
      { path: "src/a.js", name: "a.js", lang: "javascript" },
      "function processData(data) { return data; }",
      { score: 72, signals: [{ name: "nome genérico", evidence: "processData" }],
        hotspots: [{ lines: "1", why: "comentário repete" }],
        suggestions: [{ action: "renomear", where: "linha 1" }] },
      { intensidade: "padrao" })`);
    for (const t of ["src/a.js", "72%", "nome genérico", "NÃO altere o comportamento",
                     "NÃO renomeie nada exportado", "rewritten"])
      if (!p.includes(t)) throw new Error("faltou no prompt: " + t);
    const c = await rodar(`buildHumanizeCodePrompt({path:"a",name:"a",lang:"js"}, "x",
      {score:1,signals:[],hotspots:[],suggestions:[]}, { intensidade: "conservadora" })`);
    if (!c.includes("Não mude a organização")) throw new Error("a intensidade conservadora não limitou");
    return true;
  });

  // ════════════════════════════════════════════════
  //  zip.js
  // ════════════════════════════════════════════════
  await metodo("zip", "crc32", async () => {
    const r = await val(`(() => {
      const b = new TextEncoder().encode("123456789");
      return { valor: crc32(b) >>> 0, vazio: crc32(new Uint8Array(0)) >>> 0 };
    })()`);
    // valor canônico do CRC-32 para "123456789"
    if (r.valor !== 0xCBF43926) throw new Error("CRC de '123456789' deu " + r.valor.toString(16));
    if (r.vazio !== 0) throw new Error("CRC de vazio devia ser 0: " + r.vazio);
    return true;
  });

  await metodo("zip", "buildZip", async () => {
    const r = await val(`(async () => {
      const blob = buildZip([{ path: "a/b.txt", text: "conteudo" }, { path: "c.txt", text: "x" }]);
      const b = new Uint8Array(await blob.arrayBuffer());
      const txt = new TextDecoder().decode(b);
      return { bytes: b.length, pk: b[0] === 80 && b[1] === 75 && b[2] === 3 && b[3] === 4,
               temNomes: txt.includes("a/b.txt") && txt.includes("c.txt"),
               temConteudo: txt.includes("conteudo"),
               fim: b[b.length - 22] === 80 && b[b.length - 21] === 75 };
    })()`);
    if (!r.pk) throw new Error("não começa com a assinatura PK");
    if (!r.temNomes) throw new Error("os nomes dos arquivos não estão no zip");
    if (!r.temConteudo) throw new Error("o conteúdo não está no zip");
    if (!r.fim) throw new Error("falta o registro final do diretório central");
    return true;
  });

  // ════════════════════════════════════════════════
  //  code.js
  // ════════════════════════════════════════════════
  await metodo("code", "buildCodePrompt", async () => {
    const p = await rodar(`buildCodePrompt({ path: "src/x.php", name: "x.php", lang: "php" },
      "<?php echo 1;", analyzeHeuristics("<?php echo 1;", "src/x.php"),
      runForensics("<?php echo 1;", { mode: 'code' }))`);
    if (!p.includes("src/x.php")) throw new Error("o caminho não entrou");
    if (!/"score"/.test(p)) throw new Error("não pediu o score");
    if (!/NÃO reescreva/i.test(p)) throw new Error("não proibiu a reescrita na análise");
    return true;
  });

  await metodo("code", "buildFileResult", async () => {
    const r = await val(`(() => {
      const arq = { path: "a.js", name: "a.js", lang: "js", size: 100 };
      const h = analyzeHeuristics("const a = 1;", "a.js");
      const so = buildFileResult(arq, h, null, null);
      const com = buildFileResult(arq, h, { score: 80, confidence: "alta", verdict: "v",
        signals: [], hotspots: [], suggestions: [], summary: "" }, null);
      const assinado = buildFileResult(arq, h, null, { conclusive: true, score: 10, traces: [] });
      return { so: so.score, com: com.score, assinado: assinado.score,
               confSo: so.confidence, confCom: com.confidence };
    })()`);
    if (r.confSo !== "baixa") throw new Error("sem IA a confiança devia ser baixa: " + r.confSo);
    if (r.com <= r.so) throw new Error("a avaliação de IA não puxou a pontuação: " + r.com + " vs " + r.so);
    if (r.assinado < 95) throw new Error("rastro conclusivo devia forçar ≥95: " + r.assinado);
    return true;
  });

  await metodo("code", "fallbackSuggestions", async () => {
    const r = await val(`fallbackSuggestions(analyzeHeuristics(
      ${JSON.stringify(Array.from({ length: 8 }, () => "// comentario\nconst result = 1;").join("\n"))}, "a.js"))`);
    if (!Array.isArray(r) || !r.length) throw new Error("não sugeriu nada sem a IA");
    if (!r[0].action) throw new Error("sugestão sem ação: " + JSON.stringify(r[0]));
    return true;
  });

  await metodo("code", "normalizeSuggestion", async () => {
    const r = await val(`[normalizeSuggestion("Renomear   variáveis  genéricas"),
                          normalizeSuggestion("renomear variaveis genericas")]`);
    if (r[0] !== r[1]) throw new Error("não normalizou acento e espaço: " + r.join(" ≠ "));
    return true;
  });

  await metodo("code", "buildProjectReport", async () => {
    const r = await val(`(() => {
      const res = [
        { path: "grande.js", name: "g", lang: "js", size: 10000, score: 90, heuristicScore: 90,
          aiScore: 90, confidence: "alta", verdict: "", stats: null, signals: [], hotspots: [],
          suggestions: [{ action: "Renomear genéricos", where: "grande.js", impact: "alto", effort: "baixo" }],
          summary: "", forensics: null, error: null },
        { path: "pequeno.js", name: "p", lang: "js", size: 100, score: 10, heuristicScore: 10,
          aiScore: 10, confidence: "alta", verdict: "", stats: null, signals: [], hotspots: [],
          suggestions: [{ action: "Renomear genéricos", where: "pequeno.js", impact: "alto", effort: "baixo" }],
          summary: "", forensics: null, error: null }
      ];
      const rep = buildProjectReport(res);
      return { ponderado: rep.weighted, arquivos: rep.files.length,
               sugestoes: rep.globalSuggestions.length,
               arquivosDaSugestao: rep.globalSuggestions[0].files.length,
               vezes: rep.globalSuggestions[0].count, simples: rep.simple };
    })()`);
    if (r.arquivos !== 2) throw new Error("perdeu arquivo: " + r.arquivos);
    if (r.ponderado < 50)
      throw new Error("a ponderação ignorou o tamanho: " + r.ponderado + "% com um arquivo grande de 90%");
    if (r.sugestoes !== 1) throw new Error("não agrupou a mesma sugestão: " + r.sugestoes);
    if (r.arquivosDaSugestao !== 2) throw new Error("a sugestão agrupada perdeu arquivos");
    if (r.vezes !== 2) throw new Error("contou " + r.vezes + " ocorrências em vez de 2");
    if (r.simples !== 50) throw new Error("a média simples devia ser 50%: " + r.simples);
    return true;
  });

  await metodo("code", "readFileText", async () => {
    const r = await rodar(`readFileText(new File(["oi mundo"], "a.txt"))`);
    if (r !== "oi mundo") throw new Error("leu " + JSON.stringify(r));
    return true;
  });

  await metodo("code", "ingestFileList / selectedFiles / toggleAll", async () => {
    const r = await val(`(async () => {
      const arquivos = [new File(["const a = 1;"], "a.js"), new File(["x"], "b.png")];
      arquivos.forEach(f => { try { Object.defineProperty(f, 'webkitRelativePath', { value: 'proj/' + f.name }); } catch (e) {} });
      ingestFileList(arquivos);
      await new Promise(r => setTimeout(r, 200));
      const lidos = CodeState.files.length;
      const antes = selectedFiles().length;
      toggleAll(false); const nenhum = selectedFiles().length;
      toggleAll(true);  const todos = selectedFiles().length;
      return { lidos, antes, nenhum, todos,
               ignorados: CodeState.files.filter(f => f.skipReason).length };
    })()`);
    if (r.lidos < 2) throw new Error("não leu os dois arquivos: " + r.lidos);
    if (r.nenhum !== 0) throw new Error("toggleAll(false) deixou " + r.nenhum + " selecionados");
    if (r.todos < 1) throw new Error("toggleAll(true) não selecionou nada");
    if (!r.ignorados) throw new Error("a imagem devia ter sido marcada como ignorada");
    return true;
  });

  await metodo("code", "renderFileList / updateCodeButton", async () => {
    const r = await val(`(() => {
      renderFileList(); updateCodeButton();
      const linhas = document.querySelectorAll('#file-list .file-row').length;
      const resumo = document.getElementById('file-summary').textContent;
      return { linhas, resumo: resumo.trim().length };
    })()`);
    if (!r.linhas) throw new Error("não desenhou nenhuma linha");
    if (!r.resumo) throw new Error("o resumo ficou vazio");
    return true;
  });

  await metodo("code", "resetCode", async () => {
    const r = await val(`(() => { resetCode();
      return { arquivos: CodeState.files.length, resultados: CodeState.results.length }; })()`);
    if (r.arquivos || r.resultados) throw new Error("não limpou: " + JSON.stringify(r));
    return true;
  });

  // ── o fluxo de reescrita, com a API trocada por resposta controlada ──
  const prepararProjeto = async () => rodar(`
    App.apiKey = ['sk', 'ant', 'api03-teste-de-mentira'].join('-');
    CodeState.projectName = 'proj';
    CodeState.files = [
      { path: "src/a.js", name: "a.js", lang: "javascript", size: 300, include: true,
        file: new File([["function processData(data) {", "  // retorna", "  return data;", "}"]
          .join(String.fromCharCode(10))], "a.js") },
      { path: "src/b.js", name: "b.js", lang: "javascript", size: 100, include: true,
        file: new File(["const x = 1;"], "b.js") }
    ];
    CodeState.results = CodeState.files.map((f, i) => ({
      path: f.path, name: f.name, lang: f.lang, size: f.size,
      score: i === 0 ? 80 : 40, heuristicScore: 60, aiScore: 85, confidence: "media",
      verdict: "", stats: null, signals: [], hotspots: [], suggestions: [],
      summary: "", forensics: null, error: null }));
    renderReport(buildProjectReport(CodeState.results));
    initHumanizeButtons(); initProjectHumanize();
    document.querySelector('[data-detail]').open = true;
    window.callClaudeJSON = async () => ({
      rewritten: ["function normalizaPedido(pedido) {", "  return pedido;", "}"].join(String.fromCharCode(10)),
      changes: [{ what: "nome", why: "genérico", where: "linha 1" }], kept: ["a exportação"],
      risk: "nenhum", note: "" });
  `);

  await metodo("code", "initHumanizeButtons / humanizeFile", async () => {
    await prepararProjeto();
    await esperar(300);
    if (!(await rodar(`!!document.querySelector('[data-hz-run]')`)))
      throw new Error("o botão por arquivo não apareceu");
    await rodar(`document.querySelector('[data-hz-run]').click()`);
    await esperar(800);
    const r = await val(`(() => {
      const out = document.querySelector('[data-hz-out]');
      return { temPainel: !!out.querySelector('.hz-result'),
               codigo: (out.querySelector('.hz-code') || {}).textContent || '',
               deltas: (out.querySelector('.hz-deltas') || {}).textContent || '' };
    })()`);
    if (!r.temPainel) throw new Error("não montou o painel do resultado");
    if (!r.codigo.includes("normalizaPedido")) throw new Error("o código reescrito não apareceu");
    if (!/%/.test(r.deltas)) throw new Error("não mostrou o antes e depois: " + r.deltas);
    return true;
  });

  await metodo("code", "runProjectHumanize / renderProjectHumanizeResult", async () => {
    await prepararProjeto();
    await esperar(300);
    await rodar(`document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    for (let i = 0; i < 40; i++) {
      await esperar(200);
      if (await rodar(`!!document.querySelector('.pz-result')`)) break;
    }
    const r = await val(`(() => {
      const el = document.querySelector('.pz-result');
      const nums = [...el.querySelectorAll('.pz-score b')].map(b => b.textContent.trim());
      return { antesDepois: nums, linhas: el.querySelectorAll('.pz-table tbody tr').length,
               temZip: !!el.querySelector('#pz-zip') };
    })()`);
    if (r.linhas !== 2) throw new Error("linhas na tabela: " + r.linhas);
    if (r.antesDepois.length !== 2) throw new Error("faltou antes ou depois");
    if (r.antesDepois[0] === r.antesDepois[1])
      throw new Error("antes e depois iguais: " + r.antesDepois.join(" → "));
    if (!r.temZip) throw new Error("faltou o botão do zip");
    return true;
  });

  // ════════════════════════════════════════════════
  //  report.js
  // ════════════════════════════════════════════════
  const relatorioDeTeste = `buildProjectReport([
    { path: "G1/backend/src/Produtos/RepositorioIngredienteEPizza.php", name: "r.php", lang: "php",
      size: 900, score: 70, heuristicScore: 60, aiScore: 75, confidence: "media", verdict: "v",
      stats: { loc: 40, commentLines: 20, commentDensity: 50, functions: 3, humanMarkers: 0, lengthVariation: 5 },
      signals: [{ name: "s", score: 70, evidence: "e" }], hotspots: [{ lines: "1-5", score: 70, why: "w" }],
      suggestions: [{ action: "Renomear genéricos", where: "r.php", impact: "alto", effort: "baixo", rationale: "x" }],
      summary: "resumo", forensics: null, error: null }])`;

  await metodo("report", "renderReport / renderReportHeader", async () => {
    const r = await val(`(() => {
      renderReport(${relatorioDeTeste});
      return { score: document.getElementById('rep-score').textContent.trim(),
               visivel: getComputedStyle(document.getElementById('report')).display !== 'none',
               veredito: document.getElementById('rep-verdict').textContent.trim() };
    })()`);
    if (!/%/.test(r.score)) throw new Error("o percentual não apareceu: " + r.score);
    if (!r.visivel) throw new Error("o relatório ficou escondido");
    if (!r.veredito) throw new Error("sem veredito");
    return true;
  });

  await metodo("report", "renderDistribution", async () => {
    const r = await rodar(`document.getElementById('rep-dist').children.length`);
    if (!r) throw new Error("a distribuição ficou vazia");
    return true;
  });

  await metodo("report", "renderFileTable", async () => {
    const r = await val(`(() => {
      const linhas = document.querySelectorAll('#rep-table tbody tr').length;
      const conf = [...document.querySelectorAll('#rep-table .td-conf')].map(td => td.textContent.trim());
      return { linhas, conf };
    })()`);
    if (!r.linhas) throw new Error("a tabela por documento ficou vazia");
    if (r.conf.some(c => c === "erro"))
      throw new Error("a coluna confiança ainda escreve 'erro' em vez do nível");
    return true;
  });

  await metodo("report", "renderGlobalSuggestions", async () => {
    const r = await val(`(() => {
      const el = document.getElementById('rep-global');
      const chips = el.querySelectorAll('.sugg-files code');
      const fora = [...el.querySelectorAll('*')].filter(x =>
        x.scrollWidth > x.clientWidth + 2 && getComputedStyle(x).overflowX === 'visible'
        && getComputedStyle(x).textOverflow !== 'ellipsis').length;
      return { sugestoes: el.children.length, chips: chips.length, transbordo: fora };
    })()`);
    if (!r.sugestoes) throw new Error("nenhuma sugestão desenhada");
    if (r.transbordo) throw new Error(r.transbordo + " elemento(s) com conteúdo maior que a caixa");
    return true;
  });

  await metodo("report", "renderProjectHumanize", async () => {
    const r = await val(`(() => {
      const el = document.getElementById('rep-humanize');
      const ops = [...(document.getElementById('pz-depth') || { options: [] }).options]
        .map(o => o.textContent.trim());
      return { temBotao: !!document.getElementById('pz-run'), opcoes: ops };
    })()`);
    if (!r.temBotao) throw new Error("o botão de reescrever o projeto não apareceu");
    if (r.opcoes.length !== 3) throw new Error("opções de alcance: " + r.opcoes.length);
    for (const o of r.opcoes) if (!o.includes("—")) throw new Error("opção sem explicação: " + o);
    return true;
  });

  await metodo("report", "renderFileDetails", async () => {
    const r = await val(`(() => {
      const det = document.querySelectorAll('#rep-details .det').length;
      const comBotao = document.querySelectorAll('#rep-details [data-hz-run]').length;
      return { det, comBotao };
    })()`);
    if (!r.det) throw new Error("nenhum detalhe por arquivo");
    if (!r.comBotao) throw new Error("o detalhe não trouxe o botão de humanizar");
    return true;
  });

  await metodo("report", "reportToMarkdown", async () => {
    const md = await rodar(`reportToMarkdown(${relatorioDeTeste})`);
    if (!md.includes("|")) throw new Error("não montou tabela em markdown");
    if (md.includes("| erro |")) throw new Error("ainda escreve 'erro' na coluna de confiança");
    if (!md.includes("RepositorioIngredienteEPizza.php")) throw new Error("o arquivo não entrou");
    return true;
  });

  await metodo("report", "slug", async () => {
    const r = await val(`[slug("Meu Projeto Ção/X"), slug("")]`);
    if (/[\s\/çÇ]/.test(r[0])) throw new Error("slug malformado: " + r[0]);
    if (typeof r[1] !== "string") throw new Error("slug de vazio devia ser texto");
    return true;
  });

  // ════════════════════════════════════════════════
  //  layout — o que o usuário vê
  // ════════════════════════════════════════════════
  await metodo("layout", "colunas do modo código cabem na janela", async () => {
    const r = await val(`(() => {
      document.querySelector('.tab[data-mode="code"]').click();
      const el = document.querySelector('.mode-panel[data-mode="code"]');
      const cols = getComputedStyle(el).gridTemplateColumns;
      const soma = cols.split(/\\s+/).map(parseFloat).filter(n => !isNaN(n)).reduce((t, n) => t + n, 0);
      return { cols, soma: Math.round(soma), janela: document.documentElement.clientWidth,
               rolagem: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    })()`);
    if (r.soma > r.janela + 2)
      throw new Error(`as colunas somam ${r.soma}px numa janela de ${r.janela} (${r.cols})`);
    if (r.rolagem > 2) throw new Error("a página tem " + r.rolagem + "px de rolagem lateral");
    return true;
  });

  await metodo("layout", "css e js não vêm do cache", async () => {
    const r = await val(`(() => {
      const links = [...document.querySelectorAll('link[href^="css/"], script[src^="js/"]')]
        .map(el => el.getAttribute('href') || el.getAttribute('src'));
      return { total: links.length, semVersao: links.filter(u => !/\\?v=/.test(u)) };
    })()`);
    if (!r.total) throw new Error("não achei os links de css/js");
    if (r.semVersao.length)
      throw new Error("sem ?v= (o navegador serve a versão velha): " + r.semVersao.join(", "));
    return true;
  });

  ws.close(); chrome.kill();
  console.log(`métodos cobertos: ${ok.length}`);
  ok.forEach(x => console.log("  ✓", x));
  if (falhas.length) { console.log("FALHAS:"); falhas.forEach(x => console.log("  ✗", x)); }
  const reais = erros.filter(e => !/favicon|DevTools/i.test(e));
  if (reais.length) { console.log("ERROS DE CONSOLE:"); reais.slice(0, 6).forEach(e => console.log("  !", e)); }
  process.exit(falhas.length || reais.length ? 1 : 0);
})();
