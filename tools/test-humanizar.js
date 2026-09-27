/*
 * test-humanizar.js — exercita o botão de humanizar código sem gastar API.
 *
 * Injeta um resultado de análise, troca a chamada ao Claude por uma resposta
 * controlada e confere a tela: o prompt montado, o alcance de cada intensidade,
 * o painel do resultado e o aviso quando falta a chave.
 *
 * Uso: node tools/test-humanizar.js [caminho do projeto]
 * Precisa do Chrome instalado; roda sem janela.
 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = process.argv[2] || process.cwd();
const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "p1t-"));
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
    ["--headless=new", "--disable-gpu", "--allow-file-access-from-files",
     "--remote-debugging-port=9381", `--user-data-dir=${perfil}`, "--window-size=1500,1100", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(250);
    try { alvo = (await (await fetch("http://127.0.0.1:9381/json/list")).json()).find(t => t.type === "page"); } catch (e) {}
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
    if (r.result.exceptionDetails) throw new Error(String((r.result.exceptionDetails.exception || {}).description).split("\n")[0]);
    return r.result.result.value;
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: encodeURI("file:///" + RAIZ.replace(/\\/g, "/") + "/index.html") });
  await esperar(1800);

  const ok = [], falhas = [];
  const passo = async (oque, fn) => {
    try { const r = await fn(); if (r === false) falhas.push(oque); else ok.push(oque); }
    catch (e) { falhas.push(oque + " — " + String(e.message).split("\n")[0]); }
  };

  await passo("a página carrega com o módulo novo", async () => {
    const r = await rodar(`typeof buildHumanizeCodePrompt === "function" && typeof initHumanizeButtons === "function"`);
    if (!r) throw new Error("buildHumanizeCodePrompt ou initHumanizeButtons não existem");
    return true;
  });

  await passo("o prompt traz a pauta do arquivo e as proibições", async () => {
    const p = await rodar(`buildHumanizeCodePrompt(
      { path: "src/a.js", name: "a.js", lang: "javascript" },
      "function processData(data) { // retorna o resultado\\n  return data; }",
      { score: 72, signals: [{ name: "nome genérico", evidence: "processData" }],
        hotspots: [{ lines: "1-2", why: "comentário repete o código" }],
        suggestions: [{ action: "renomear processData", where: "linha 1" }] },
      { intensidade: "padrao" })`);
    for (const t of ["src/a.js", "72%", "nome genérico", "comentário repete o código",
                     "NÃO altere o comportamento", "NÃO renomeie nada exportado", "rewritten"]) {
      if (!p.includes(t)) throw new Error("faltou no prompt: " + t);
    }
    if (!p.includes("padrão — inclui") && !p.includes("organização interna")) {
      throw new Error("o alcance da reescrita não entrou no prompt");
    }
    return true;
  });

  await passo("a intensidade muda o alcance declarado", async () => {
    const base = { path: "a.js", name: "a.js", lang: "js" };
    const an = { score: 50, signals: [], hotspots: [], suggestions: [] };
    const c = await rodar(`buildHumanizeCodePrompt(${JSON.stringify(base)}, "x", ${JSON.stringify(an)}, { intensidade: "conservadora" })`);
    const f = await rodar(`buildHumanizeCodePrompt(${JSON.stringify(base)}, "x", ${JSON.stringify(an)}, { intensidade: "profunda" })`);
    if (!c.includes("Não mude a organização")) throw new Error("conservadora não limitou");
    if (!f.includes("abstração prematura")) throw new Error("profunda não liberou");
    return true;
  });

  await passo("o botão aparece no cartão e a reescrita roda", async () => {
    // monta um resultado de análise à mão e pinta o relatório
    await rodar(`
      App.apiKey = 'sk-ant-chave-de-mentira-para-o-teste-0000';
      CodeState.files = [{ path: "src/exemplo.js", name: "exemplo.js", lang: "javascript",
        size: 120, include: true,
        file: new File(["function processData(data) {\\n  // retorna o resultado\\n  return data;\\n}\\n"], "exemplo.js") }];
      CodeState.results = [{ path: "src/exemplo.js", name: "exemplo.js", lang: "javascript",
        size: 120, score: 72, heuristicScore: 64, aiScore: 76, confidence: "media",
        verdict: "provável geração", stats: null,
        signals: [{ name: "nome genérico", score: 70, evidence: "processData" }],
        hotspots: [{ lines: "1-3", score: 70, why: "comentário repete o código" }],
        suggestions: [{ action: "renomear processData", where: "linha 1", impact: "alto", effort: "baixo" }],
        summary: "", forensics: null, error: null }];
      renderReport(buildProjectReport(CodeState.results));
      initHumanizeButtons();
      // a chamada à API vira mentira controlada
      window.callClaudeJSON = async () => ({
        rewritten: "function normalizaPedido(pedido) {\\n  return pedido;\\n}\\n",
        changes: [{ what: "processData virou normalizaPedido", why: "nome genérico", where: "linha 1" }],
        kept: ["a assinatura de exportação"],
        risk: "nenhum",
        note: "sobrou pouca coisa"
      });
      document.querySelector('[data-detail]').open = true;
    `);
    await esperar(300);
    const temBotao = await rodar(`!!document.querySelector('[data-hz-run]')`);
    if (!temBotao) throw new Error("o botão não apareceu no cartão");

    await rodar(`document.querySelector('[data-hz-run]').click()`);
    await esperar(900);
    const r = JSON.parse(await rodar(`(() => {
      const out = document.querySelector('[data-hz-out]');
      const codigo = out.querySelector('.hz-code');
      return JSON.stringify({
        temResultado: !!out.querySelector('.hz-result'),
        codigo: codigo ? codigo.textContent.trim() : '',
        deltas: (out.querySelector('.hz-deltas') || {}).textContent || '',
        temCopiar: !!out.querySelector('[data-hz-copy]'),
        temBaixar: !!out.querySelector('[data-hz-download]'),
        mudancas: out.querySelectorAll('.hz-list').length
      });
    })()`));
    if (!r.temResultado) throw new Error("não montou o painel: " + (await rodar(`document.querySelector('[data-hz-out]').textContent`)));
    if (!r.codigo.includes("normalizaPedido")) throw new Error("o código reescrito não apareceu");
    if (!/64%/.test(r.deltas)) throw new Error("não mostrou a heurística anterior: " + r.deltas);
    if (!r.temCopiar || !r.temBaixar) throw new Error("faltou copiar ou baixar");
    if (r.mudancas < 2) throw new Error("faltou a lista do que mudou / do que foi mantido");
    console.log("     (deltas: " + r.deltas.replace(/\s+/g, " ").trim() + ")");
    return true;
  });

  await passo("sem chave de API, avisa em vez de tentar", async () => {
    await rodar(`App.apiKey = ''; document.querySelector('[data-hz-out]').innerHTML = '';`);
    await rodar(`document.querySelector('[data-hz-run]').click()`);
    await esperar(400);
    const txt = await rodar(`document.querySelector('[data-hz-out]').textContent`);
    if (!/chave/i.test(txt)) throw new Error("não avisou sobre a chave: " + txt);
    return true;
  });

  await passo("reescrever o projeto inteiro mede o antes e o depois", async () => {
    await rodar(`
      App.apiKey = 'sk-ant-chave-de-mentira-para-o-teste-0000';
      CodeState.projectName = 'exemplo';
      CodeState.files = [
        { path: "src/a.js", name: "a.js", lang: "javascript", size: 300, include: true,
          file: new File([["function processData(data) {", "  // retorna",
            "  return data;", "}"].join(String.fromCharCode(10))], "a.js") },
        { path: "src/b.js", name: "b.js", lang: "javascript", size: 100, include: true,
          file: new File(["const x = 1;"], "b.js") }
      ];
      CodeState.results = CodeState.files.map((f, i) => ({
        path: f.path, name: f.name, lang: f.lang, size: f.size,
        score: i === 0 ? 80 : 40, heuristicScore: 60, aiScore: 85, confidence: "media",
        verdict: "", stats: null, signals: [], hotspots: [], suggestions: [],
        summary: "", forensics: null, error: null
      }));
      renderReport(buildProjectReport(CodeState.results));
      initHumanizeButtons(); initProjectHumanize();
      // reescrita e reanálise, as duas de mentira
      let chamada = 0;
      window.callClaudeJSON = async () => {
        chamada++;
        return chamada % 2 === 1
          ? { rewritten: ["function normalizaPedido(pedido) {", "  return pedido;", "}"]
                .join(String.fromCharCode(10)),
              changes: [{ what: "nome", why: "genérico" }], kept: [], risk: "nenhum" }
          : { score: 20, confidence: "media", verdict: "parece autoral",
              signals: [], hotspots: [], suggestions: [], summary: "" };
      };
    `);
    await esperar(300);
    if (!(await rodar(`!!document.getElementById('pz-run')`)))
      throw new Error("o botão de reescrever tudo não apareceu");

    await rodar(`document.getElementById('pz-run').click()`);
    // espera o fim (2 arquivos x 2 chamadas)
    for (let i = 0; i < 40; i++) {
      await esperar(200);
      if (await rodar(`!!document.querySelector('.pz-result')`)) break;
    }
    const r = JSON.parse(await rodar(`(() => {
      const el = document.querySelector('.pz-result');
      if (!el) return JSON.stringify({ falta: true });
      const nums = [...el.querySelectorAll('.pz-score b')].map(b => b.textContent.trim());
      return JSON.stringify({
        falta: false, antesDepois: nums,
        queda: (el.querySelector('.pz-queda') || {}).textContent || '',
        linhas: el.querySelectorAll('.pz-table tbody tr').length,
        temZip: !!el.querySelector('#pz-zip')
      });
    })()`));
    if (r.falta) throw new Error("não montou o resumo do projeto");
    if (r.linhas !== 2) throw new Error("linhas na tabela: " + r.linhas);
    if (!r.temZip) throw new Error("faltou o botão de baixar o zip");
    if (r.antesDepois[0] === r.antesDepois[1]) throw new Error("antes e depois iguais: " + r.antesDepois.join(" → "));
    console.log("     (projeto: " + r.antesDepois.join(" → ") + ", " + r.queda.trim() + ")");
    return true;
  });

  await passo("o zip sai com os arquivos reescritos", async () => {
    const r = JSON.parse(await rodar(`(async () => {
      const zip = buildZip([{ path: "src/a.js", text: "conteudo a" }, { path: "src/b.js", text: "b" }]);
      const buf = new Uint8Array(await zip.arrayBuffer());
      const ass = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
      return JSON.stringify({ bytes: buf.length, pk: ass === "PK" + String.fromCharCode(3,4) });
    })()`));
    if (!r.pk) throw new Error("o arquivo não começa com a assinatura PK");
    if (r.bytes < 100) throw new Error("zip pequeno demais: " + r.bytes);
    return true;
  });

  ws.close(); chrome.kill();
  console.log("ok: " + ok.length);
  ok.forEach(x => console.log("  ✓", x));
  if (falhas.length) { console.log("FALHAS:"); falhas.forEach(x => console.log("  ✗", x)); }
  const reais = erros.filter(e => !/favicon|DevTools/i.test(e));
  if (reais.length) { console.log("ERROS DE CONSOLE:"); reais.slice(0, 5).forEach(e => console.log("  !", e)); }
  process.exit(falhas.length || reais.length ? 1 : 0);
})();
