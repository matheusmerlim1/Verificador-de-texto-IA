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

    // e de novo numa janela estreita, que é onde o caminho longo costuma estourar
    await send("Emulation.setDeviceMetricsOverride",
      { width: 820, height: 900, deviceScaleFactor: 1, mobile: false });
    await esperar(400);
    const estreito = JSON.parse(await rodar(`(() => {
      const doc = document.documentElement;
      const fora = [...document.querySelectorAll('.pz-result *, .rep-section *')]
        .filter(el => el.getBoundingClientRect().right > doc.clientWidth + 2)
        .map(el => (el.className || el.tagName));
      return JSON.stringify({ rolagem: doc.scrollWidth - doc.clientWidth, fora: fora.slice(0, 4) });
    })()`));
    await send("Emulation.clearDeviceMetricsOverride");
    if (estreito.rolagem > 2)
      throw new Error("a 820px a página ganhou rolagem lateral de " + estreito.rolagem + "px");
    if (estreito.fora.length)
      throw new Error("a 820px passa da largura: " + estreito.fora.join(" | "));

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

  await passo("os botões têm cor legível", async () => {
    const r = JSON.parse(await rodar(`(() => {
      const ver = el => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { fundo: cs.backgroundColor, cor: cs.color, classe: el.className };
      };
      return JSON.stringify({
        rodar: ver(document.getElementById('pz-run')),
        arquivo: ver(document.querySelector('[data-hz-run]'))
      });
    })()`));
    // contraste de verdade: o fundo não pode ser igual à cor do texto
    for (const [quem, b] of Object.entries(r)) {
      if (!b) throw new Error("não achei o botão: " + quem);
      if (b.fundo === b.cor) throw new Error(`${quem}: fundo e texto na mesma cor (${b.cor})`);
      if (!/btn-(primary|ghost)/.test(b.classe))
        throw new Error(`${quem}: sem variante de cor — classe "${b.classe}"`);
    }
    return true;
  });

  await passo("o alcance explica cada opção", async () => {
    const ops = JSON.parse(await rodar(`JSON.stringify(
      [...document.getElementById('pz-depth').options].map(o => o.textContent.trim()))`));
    if (ops.length !== 3) throw new Error("opções: " + ops.length);
    for (const o of ops) {
      if (!o.includes("—")) throw new Error("opção sem explicação: " + o);
    }
    return true;
  });

  await passo("reanálise que falha não apaga o depois", async () => {
    await rodar(`
      let n = 0;
      window.callClaudeJSON = async () => {
        n++;
        if (n % 2 === 1) return { rewritten: ["function normalizaPedido(p) {", "  return p;", "}"]
          .join(String.fromCharCode(10)), changes: [], kept: [], risk: "nenhum" };
        throw new Error('Erro da API (400): chave sem workspace');
      };
      document.getElementById('pz-out').innerHTML = '';
    `);
    await rodar(`document.getElementById('pz-run').click()`);
    for (let i = 0; i < 40; i++) {
      await esperar(200);
      if (await rodar(`!!document.querySelector('.pz-result')`)) break;
    }
    const r = JSON.parse(await rodar(`(() => {
      const linhas = [...document.querySelectorAll('.pz-table tbody tr')].map(tr => {
        const c = [...tr.children].map(td => td.textContent.trim());
        return { arquivo: c[0], antes: c[1], depois: c[2], queda: c[3] };
      });
      const depois = document.querySelectorAll('.pz-score b')[1];
      return JSON.stringify({ linhas, resumoDepois: depois ? depois.textContent.trim() : null });
    })()`));
    if (!r.linhas.length) throw new Error("tabela vazia");
    for (const l of r.linhas) {
      if (l.depois === '—')
        throw new Error("o depois sumiu mesmo com a heurística disponível: " + JSON.stringify(l));
      if (/workspace|Erro da API/i.test(l.queda))
        throw new Error("mensagem de erro na coluna queda: " + l.queda);
      if (!/heurística/i.test(l.depois))
        throw new Error("não disse que a medida veio da heurística: " + l.depois);
    }
    if (!r.resumoDepois || r.resumoDepois === '—')
      throw new Error("o resumo não trouxe o depois: " + r.resumoDepois);
    console.log("     (com a reanálise falhando: " + r.linhas[0].antes + " → " + r.linhas[0].depois + ")");
    return true;
  });

  await passo("caminho longo não estoura a caixa", async () => {
    // O caso que estoura de verdade é o caminho sem ponto de quebra: um item flex não
    // encolhe abaixo do min-content, e sem overflow-wrap o min-content é o caminho inteiro.
    // O caso real: projeto grande, muitos caminhos longos, e a sugestão do projeto listando
    // dezenas de arquivos. É o volume que faz a coluna do relatório crescer.
    const longos = Array.from({ length: 131 }, (_, i) =>
      `G1/backend/src/Produtos/RepositorioDeIngredienteEPizza${i}.php`);
    await rodar(`
      const longos = ${JSON.stringify(longos)};
      App.apiKey = 'sk-ant-chave-de-mentira-para-o-teste-0000';
      CodeState.projectName = 'g1';
      CodeState.files = longos.map((p, i) => ({
        path: p, name: p.split('/').pop(), lang: p.endsWith('.ts') ? 'typescript' : 'php',
        size: 900 - i * 100, include: true, file: new File(["const x = 1;"], "a.ts")
      }));
      CodeState.results = CodeState.files.map(f => ({
        path: f.path, name: f.name, lang: f.lang, size: f.size, score: 70,
        heuristicScore: 60, aiScore: 75, confidence: "media", verdict: "", stats: null,
        signals: [], hotspots: [],
        // sugestões com MUITOS arquivos: é o bloco que estourou na tela
        suggestions: [{ action: "Reduzir a densidade de comentários para a faixa de 5–12%",
                        where: f.path, impact: "alto", effort: "baixo",
                        rationale: "Densidade uniformemente alta é marca registrada de LLM." }],
        summary: "", forensics: null, error: null
      }));
      document.querySelector('.tab[data-mode="code"]').click();
      renderFileList();
      renderReport(buildProjectReport(CodeState.results));
      initHumanizeButtons(); initProjectHumanize();
      window.callClaudeJSON = async () => {
        throw new Error('Esta chave é da organização e não de um workspace: preencha o campo '
          + '"Workspace" na barra do topo com o ID do workspace (console.anthropic.com → '
          + 'Settings → Workspaces, o id começa com wrkspc_). Ou use uma chave criada dentro '
          + 'de um workspace, que dispensa o campo.');
      };
      document.getElementById('pz-out').innerHTML = '';
    `);
    await esperar(200);
    await rodar(`document.getElementById('pz-run').click()`);
    for (let i = 0; i < 40; i++) {
      await esperar(200);
      if (await rodar(`!!document.querySelector('.pz-result')`)) break;
    }

    const medir = async () => JSON.parse(await rodar(`(() => {
      const doc = document.documentElement;
      const limite = doc.clientWidth;
      // Dois sintomas diferentes: passar da largura da janela (rolagem) e ter conteúdo
      // maior que a própria caixa (corte). O que o usuário viu foi o segundo.
      const fora = [];
      document.querySelectorAll('.report *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > limite + 2) fora.push('passa da janela: ' + (el.className || el.tagName));
        const cs = getComputedStyle(el);
        // rolar de propósito (o bloco de código) e truncar com reticências (o caminho na
        // tabela) são decisões, não defeitos — o defeito é o conteúdo vazar sem aviso
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
        if (cs.textOverflow === 'ellipsis') return;
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
          fora.push('cortado: ' + (el.className || el.tagName) + ' (' + el.scrollWidth + '>' + el.clientWidth + ')');
      });
      const res = document.querySelector('.pz-result');
      return JSON.stringify({
        largura: limite,
        rolagem: doc.scrollWidth - limite,
        fora: fora.slice(0, 5),
        vezes: res ? (res.textContent.match(/workspace/g) || []).length : 0,
        linhas: document.querySelectorAll('.pz-table tbody tr').length
      });
    })()`));

    // a tela larga primeiro
    const largo = await medir();
    if (largo.linhas !== 131) throw new Error("linhas na tabela: " + largo.linhas);
    // a mensagem longa é a mesma para todos: uma vez só (o texto contém "workspace" 3x)
    if (largo.vezes > 3) throw new Error("a mensagem se repetiu por arquivo (" + largo.vezes + " ocorrências de 'workspace')");

    // As duas colunas do modo código só existem acima de 820px — e é justamente lá que a
    // faixa 1fr pode crescer além do espaço e empurrar a página. Abaixo disso o layout já
    // vira uma coluna e o problema não aparece.
    await send("Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await esperar(500);
    const estreito = await medir();
    await send("Emulation.clearDeviceMetricsOverride");
    await esperar(200);

    if (estreito.rolagem > 2)
      throw new Error(`a ${estreito.largura}px a página ganhou ${estreito.rolagem}px de rolagem lateral`);
    if (estreito.fora.length)
      throw new Error(`a ${estreito.largura}px passa da largura: ` + estreito.fora.join(" | "));

    // O relatório usa a página inteira: o modo código é de uma coluna só, e é isso que dá
    // espaço para caminho de arquivo, chips e tabela sem empurrar nada para fora.
    const largura = JSON.parse(await rodar(`(() => {
      const doc = document.documentElement;
      const rep = document.querySelector('.mode-panel[data-mode="code"] .result-side');
      return JSON.stringify({
        janela: doc.clientWidth,
        relatorio: rep ? Math.round(rep.getBoundingClientRect().width) : 0,
        colunas: getComputedStyle(document.querySelector('.mode-panel[data-mode="code"]')).gridTemplateColumns
      });
    })()`));
    if (largura.relatorio < largura.janela * 0.9)
      throw new Error(`o relatório ficou com ${largura.relatorio}px de ${largura.janela}px — `
        + `ainda está dividindo a largura (colunas: ${largura.colunas})`);
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
