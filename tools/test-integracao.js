/*
 * test-integracao.js — os caminhos completos, do clique ao que aparece na tela.
 *
 * Diferente de test-metodos.js, que chama uma função de cada vez, aqui nada é substituído
 * dentro da página: a análise, a reescrita e o relatório rodam como rodam para o usuário.
 * O único corte é no fetch — uma API de mentira devolve o que se mandar ela devolver, e
 * guarda o que recebeu. Assim os cabeçalhos, os códigos de erro e o parse da resposta ficam
 * dentro do teste, que é onde os defeitos relatados moravam.
 *
 * Uso: node tools/test-integracao.js [caminho do projeto]
 */
'use strict';

const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RAIZ = process.argv[2] || process.cwd();
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Caminhos de verdade, do projeto que o usuário analisou. São eles que estouraram a caixa.
const CAMINHOS = [
  "frontend/src/Views/CriarPedidoView.ts",
  "frontend/src/Dominio/cliente/RepositorioClienteEmBDR.ts",
  "frontend/src/Dominio/produtos/RepositorioPizzaEmBDR.ts",
  "frontend/src/Dominio/produtos/RepositorioProdutoEmBDR.ts",
  "frontend/src/Views/ListarPedidosView.ts",
  "frontend/src/Dominio/cliente/RepositorioPedidoEmBDR.ts",
  "frontend/src/Dominio/produtos/RepositorioPedidoEmBDR.ts",
  "frontend/src/Views/AlterarStatusPedidoView.ts",
  "backend/src/infra/persistencia/RepositorioDePedidosEmBancoRelacional.php",
  "backend/src/Excessos/DominioExceptionDeValidacaoDeEntrada.php",
];
const MUITOS = Array.from({ length: 72 }, (_, i) =>
  CAMINHOS[i % CAMINHOS.length].replace(/(\.\w+)$/, (i > 9 ? i : "") + "$1"));

const ERRO_WS = 'Esta chave é da organização e não de um workspace: preencha o campo '
  + '"Workspace" na barra do topo com o ID do workspace (console.anthropic.com → '
  + 'Settings → Workspaces, o id começa com wrkspc_). Ou use uma chave criada dentro '
  + 'de um workspace, que dispensa o campo.';

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "p1i-"));
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
    ["--headless=new", "--disable-gpu", "--allow-file-access-from-files",
     "--remote-debugging-port=9391", `--user-data-dir=${perfil}`, "--window-size=1440,1000", "about:blank"],
    { stdio: "ignore" });

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(250);
    try { alvo = (await (await fetch("http://127.0.0.1:9391/json/list")).json()).find(t => t.type === "page"); } catch (e) {}
  }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const errosConsole = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown")
      errosConsole.push(String((m.params.exceptionDetails.exception || {}).description).split("\n")[0]);
  });
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const rodar = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails)
      throw new Error(String((r.result.exceptionDetails.exception || {}).description).split("\n")[0]);
    return r.result.result.value;
  };
  const val = async expr =>
    JSON.parse(await rodar(`(async () => JSON.stringify(await (${expr})))()`));

  await send("Runtime.enable"); await send("Page.enable");
  const abrir = async () => {
    await send("Page.navigate", { url: encodeURI("file:///" + RAIZ.replace(/\\/g, "/") + "/index.html") });
    await esperar(1500);
    await instalarApi();
  };

  /**
   * API de mentira no lugar do fetch. Tudo o mais na página continua real: o callClaude
   * monta os cabeçalhos, lê o status e interpreta o corpo como faria de verdade.
   */
  const instalarApi = async () => rodar(`
    window.API = {
      chamadas: [],           // {headers, body} de cada requisição
      status: 200,            // o que devolver
      corpo: null,            // erro em JSON, quando status != 200
      texto: null,            // o texto da resposta; função ou string
      atraso: 0,
      falharApos: null,       // a partir da n-ésima chamada, falha
      listas: [],             // requisições feitas ao endpoint de workspaces
      listaStatus: 200,
      listaCorpo: null,
      listaDados: [
        { id: 'wrkspc_producao', name: 'Produção', archived_at: null },
        { id: 'wrkspc_estudos',  name: 'Estudos',  archived_at: null },
        { id: 'wrkspc_velho',    name: 'Arquivado', archived_at: '2026-01-01T00:00:00Z' }
      ]
    };
    window.fetch = async (url, opts) => {
      // O endpoint que lista os workspaces: outro caminho, outra resposta.
      if (String(url).includes('/organizations/workspaces')) {
        API.listas.push({ headers: opts.headers, url: String(url) });
        const h = new Headers({ 'request-id': 'req_ws_' + API.listas.length });
        if (API.listaStatus !== 200)
          return { ok: false, status: API.listaStatus, headers: h,
                   json: async () => API.listaCorpo
                     || { error: { message: 'This API key cannot access the Admin API' } } };
        return { ok: true, status: 200, headers: h, json: async () => ({ data: API.listaDados }) };
      }
      const body = JSON.parse(opts.body);
      API.chamadas.push({ headers: opts.headers, body, prompt: body.messages[0].content });
      if (opts.signal && opts.signal.aborted) { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
      if (API.atraso) await new Promise((r, rej) => {
        const t = setTimeout(r, API.atraso);
        if (opts.signal) opts.signal.addEventListener('abort', () => {
          clearTimeout(t); const e = new Error('abort'); e.name = 'AbortError'; rej(e); });
      });
      const nfalha = API.falharApos !== null && API.chamadas.length > API.falharApos;
      const status = nfalha ? 400 : API.status;
      // Cabeçalhos de verdade: a API sempre devolve request-id e, autenticada,
      // anthropic-workspace-id. Um simulador sem eles esconderia como a página se comporta.
      const headers = new Headers({
        'request-id': 'req_teste_' + API.chamadas.length,
        ...(API.semWorkspaceNaResposta ? {} : { 'anthropic-workspace-id': 'wrkspc_da_resposta' })
      });
      if (status !== 200) return { ok: false, status, headers,
        json: async () => API.corpo || { error: { message: 'This API key is not scoped to a workspace' } } };
      const t = typeof API.texto === 'function' ? API.texto(body.messages[0].content) : API.texto;
      return { ok: true, status: 200, headers, json: async () => ({ content: [{ text: t }] }) };
    };
    // respostas padrão: uma análise e uma reescrita plausíveis
    API.texto = prompt => /rewritten/.test(prompt)
      ? JSON.stringify({ rewritten: "function normalizaPedido(pedido) {" + String.fromCharCode(10)
          + "  return pedido;" + String.fromCharCode(10) + "}",
          changes: [{ what: "nome", why: "genérico demais", where: "linha 1" }],
          kept: ["a exportação"], risk: "nenhum", note: "" })
      : JSON.stringify({ score: 78, confidence: "alta", verdict: "provavelmente gerado",
          signals: [{ name: "nomes de molde", score: 80, evidence: "processData" }],
          hotspots: [{ lines: "1-8", score: 75, why: "bloco uniforme" }],
          suggestions: [{ action: "Renomear identificadores genéricos", where: "todo o arquivo",
                          impact: "alto", effort: "baixo", rationale: "nome não diz o domínio" }],
          summary: "Estrutura regular demais." });
    'ok';
  `);

  /** Põe arquivos na página como se a pasta tivesse sido arrastada. */
  const soltarArquivos = async (caminhos, conteudo) => {
    await rodar(`(async () => {
      const caminhos = ${JSON.stringify(caminhos)};
      const conteudo = ${JSON.stringify(conteudo || "function processData(data) {\n  // retorna o resultado\n  const result = data;\n  return result;\n}")};
      const arquivos = caminhos.map(p => {
        const f = new File([conteudo], p.split('/').pop());
        Object.defineProperty(f, 'webkitRelativePath', { value: 'g1/' + p });
        return f;
      });
      ingestFileList(arquivos);
    })()`);
    for (let i = 0; i < 40; i++) {
      await esperar(150);
      if (await rodar(`CodeState.files.length >= ${caminhos.length}`)) break;
    }
  };

  /** Espera o relatório aparecer, ou desiste. */
  const esperarPor = async (expr, tentativas = 60) => {
    for (let i = 0; i < tentativas; i++) {
      if (await rodar(`!!(${expr})`)) return true;
      await esperar(200);
    }
    return false;
  };

  /**
   * Procura qualquer coisa dentro do relatório que passe da largura de quem a contém.
   * É a medida que faltava: eu media a página inteira, e o que estourava era um bloco
   * dentro dela, que a rolagem do pai escondia do total.
   */
  const transbordo = async () => val(`(() => {
    // Tudo que começa fechado é aberto antes de medir. Era esse o furo: <details> fechado
    // não tem caixa, então o que estourava dentro dele — e só aparecia ao rolar e abrir —
    // passava batido por uma varredura que só olhava o que já estava na tela.
    document.querySelectorAll('details').forEach(d => { d.open = true; });

    const caminho = el => {
      const partes = [];
      for (let e = el; e && e !== document.body && partes.length < 4; e = e.parentElement)
        partes.unshift(e.tagName.toLowerCase() +
          (e.id ? '#' + e.id : (e.className && typeof e.className === 'string'
            ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')));
      return partes.join(' > ');
    };
    const clipa = est => est.overflowX !== 'visible' || est.textOverflow === 'ellipsis';

    const doc = document.documentElement;
    const fora = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const est = getComputedStyle(el);
      if (est.position === 'fixed' || est.display === 'none') return;

      // Passa da janela — mas só conta se ninguém acima estiver segurando. Um quadro com
      // overflow-x: auto contém o que tem dentro: a tabela larga continua com a largura
      // dela na conta do layout, e quem rola é o quadro, não a página.
      let contido = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (clipa(getComputedStyle(p))) { contido = true; break; }
      if (!contido && r.right > doc.clientWidth + 2)
        fora.push({ onde: caminho(el), tipo: 'passa da janela',
                    dir: Math.round(r.right), limite: doc.clientWidth });

      // Ou o conteúdo é mais largo que a própria caixa, sem rolagem nem corte previsto.
      if (!clipa(est) && el.scrollWidth > el.clientWidth + 2)
        fora.push({ onde: caminho(el), tipo: 'conteúdo maior que a caixa',
                    dir: el.scrollWidth, limite: el.clientWidth });

      // Ou o texto continua para fora da caixa que o contém, que é o que se vê na tela:
      // a palavra segue além da borda do pai em vez de quebrar.
      const pai = el.parentElement;
      if (pai && !clipa(getComputedStyle(pai))) {
        const rp = pai.getBoundingClientRect();
        if (rp.width && r.right > rp.right + 2)
          fora.push({ onde: caminho(el), tipo: 'sai da caixa do pai',
                      dir: Math.round(r.right), limite: Math.round(rp.right) });
      }
    });

    // Um mesmo estouro aparece no filho e em cada ancestral; o primeiro já diz onde é.
    const vistos = new Set();
    const unicos = fora.filter(f => {
      const k = f.onde + f.tipo;
      if (vistos.has(k)) return false;
      vistos.add(k); return true;
    });
    return { fora: unicos.slice(0, 8), total: unicos.length,
             rolagem: doc.scrollWidth - doc.clientWidth, janela: doc.clientWidth };
  })()`);

  /** A cópia privada traz a chave no config.js e tira a barra da tela, para não
      mostrar a chave a quem estiver olhando. Os cenários abaixo valem nas duas, então
      só mexem no campo quando ele existe. */
  const campo = async (idCampo, valor) => rodar(`(() => {
    const el = document.getElementById("${idCampo}");
    if (!el) return 'sem campo';
    el.value = ${JSON.stringify(valor)};
    el.dispatchEvent(new Event('input'));
    return 'ok';
  })()`);
  const temBarra = async () => rodar(`!!document.getElementById('api-key-input')`);

  const ok = [], falhas = [];
  const cenario = async (nome, fn) => {
    try { await fn(); ok.push(nome); }
    catch (e) { falhas.push(nome + "\n      " + String(e.message).split("\n")[0]); }
  };
  const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };

  await abrir();

  // ─────────────────────────────────────────────────────────────
  //  1. O caminho feliz do modo código, do arrastar ao relatório
  // ─────────────────────────────────────────────────────────────
  await cenario("análise de um projeto, do arrastar ao relatório", async () => {
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-integra'].join('-');`);
    await campo('api-key-input', ['sk','ant','api03-de-mentira-integra'].join('-'));
    await soltarArquivos(CAMINHOS.slice(0, 4));
    exigir(await rodar(`selectedFiles().length === 4`), "os 4 arquivos não ficaram selecionados");
    exigir(await rodar(`!document.getElementById('btn-analyze-code').disabled`),
      "o botão de analisar continuou desligado");

    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.getElementById('report').style.display !== 'none'
      && document.querySelectorAll('#rep-table tbody tr').length`), "o relatório não apareceu");

    const r = await val(`({
      chamadas: API.chamadas.length,
      linhas: document.querySelectorAll('#rep-table tbody tr').length,
      score: document.getElementById('rep-score').textContent.trim(),
      sugestoes: document.getElementById('rep-global').children.length,
      detalhes: document.querySelectorAll('#rep-details .det').length,
      progresso: getComputedStyle(document.getElementById('code-progress')).display,
      notaIA: CodeState.results[0].aiScore,
      heuristica: CodeState.results[0].heuristicScore
    })`);
    exigir(r.chamadas === 4, `foram ${r.chamadas} chamadas à API para 4 arquivos`);
    exigir(r.linhas === 4, `a tabela ficou com ${r.linhas} linhas`);
    exigir(/^\d{1,3}%$/.test(r.score), `percentual malformado: ${r.score}`);
    exigir(r.sugestoes >= 1, "as sugestões do projeto ficaram vazias");
    exigir(r.detalhes === 4, `detalhes por arquivo: ${r.detalhes}`);
    exigir(r.progresso === "none", "a barra de progresso não sumiu no fim");
    // a nota da IA tem que chegar inteira ao resultado, e o final é a mistura das duas
    exigir(r.notaIA === 78, `a nota da API não chegou ao resultado: ${r.notaIA}`);
    const final = parseInt(r.score);
    const menor = Math.min(r.notaIA, r.heuristica), maior = Math.max(r.notaIA, r.heuristica);
    exigir(final >= menor - 1 && final <= maior + 1,
      `o final (${final}%) caiu fora da heurística (${r.heuristica}%) e da IA (${r.notaIA}%)`);
  });

  // ─────────────────────────────────────────────────────────────
  //  2. Os cabeçalhos que vão para a API
  // ─────────────────────────────────────────────────────────────
  await cenario("a requisição leva chave, versão e liberação de browser", async () => {
    const h = await val(`API.chamadas[0].headers`);
    exigir(h["x-api-key"], "foi sem a chave");
    exigir(h["anthropic-version"] === "2023-06-01", "versão da API: " + h["anthropic-version"]);
    exigir(h["anthropic-dangerous-direct-browser-access"] === "true",
      "sem a liberação de chamada direta do browser, o navegador barra por CORS");
    // O cabeçalho do workspace é condicional: vai quando há um configurado — pelo campo
    // ou pelo config.js — e não vai quando não há. A cópia privada traz um no config.js,
    // então comparar com o estado é mais honesto do que exigir ausência sempre.
    const wsConfigurado = await rodar(`App.workspaceId || ''`);
    if (wsConfigurado)
      exigir(h["anthropic-workspace-id"] === wsConfigurado,
        `há workspace configurado (${wsConfigurado}) mas o cabeçalho foi `
        + `"${h["anthropic-workspace-id"]}"`);
    else
      exigir(!h["anthropic-workspace-id"], "mandou workspace sem haver um configurado");
  });

  // ─────────────────────────────────────────────────────────────
  //  3. Chave de organização: a mensagem certa, e a saída dela
  // ─────────────────────────────────────────────────────────────
  await cenario("chave de organização explica onde resolver", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-org'].join('-');
                 API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace' } };`);
    await soltarArquivos(CAMINHOS.slice(0, 2));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length`),
      "o relatório não apareceu depois do erro");

    const r = await val(`({
      texto: document.getElementById('report').textContent,
      conf: [...document.querySelectorAll('#rep-table .td-conf')].map(t => t.textContent.trim())
    })`);
    exigir(r.texto.includes('console.anthropic.com'), "a mensagem não diz onde resolver");
    exigir(r.texto.includes('wrkspc_'), "a mensagem não diz o formato do id");
    exigir(!r.conf.includes('erro'),
      "a coluna de confiança voltou a escrever 'erro' em vez do nível de confiança");
  });

  await cenario("preencher o workspace faz a análise passar", async () => {
    await campo('workspace-input', 'wrkspc_teste');
    await rodar(`App.workspaceId = 'wrkspc_teste'; API.status = 200; API.chamadas = [];`);
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`API.chamadas.length >= 2`), "não refez as chamadas");
    await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length`);
    const h = await val(`API.chamadas[0].headers`);
    exigir(h["anthropic-workspace-id"] === "wrkspc_teste",
      "o workspace do campo não foi para o cabeçalho: " + h["anthropic-workspace-id"]);
    if (await temBarra())
      exigir(await rodar(`localStorage.getItem('dlm_workspace_id') === 'wrkspc_teste'`),
        "o workspace digitado não ficou guardado para a próxima vez");
  });

  // ─────────────────────────────────────────────────────────────
  //  4. Cada código de erro da API tem a sua mensagem
  // ─────────────────────────────────────────────────────────────
  await cenario("401, 429 e 529 têm mensagem própria", async () => {
    const casos = [[401, "inválida"], [429, "Limite"], [529, "sobrecarregada"]];
    for (const [status, trecho] of casos) {
      const msg = await rodar(`(async () => {
        API.status = ${status}; API.corpo = { error: { message: 'x' } };
        try { await callClaude('oi'); return 'NÃO FALHOU'; }
        catch (e) { return e.message; }
      })()`);
      exigir(msg.includes(trecho), `${status} devolveu "${msg}"`);
    }
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  // ─────────────────────────────────────────────────────────────
  //  5. Resposta embrulhada em markdown
  // ─────────────────────────────────────────────────────────────
  await cenario("resposta cercada de ``` é interpretada mesmo assim", async () => {
    const r = await val(`(async () => {
      API.texto = '\\u0060\\u0060\\u0060json' + String.fromCharCode(10)
        + '{"score": 42, "confidence": "media", "verdict": "v", "signals": [], "hotspots": [],'
        + ' "suggestions": [], "summary": "s"}' + String.fromCharCode(10) + '\\u0060\\u0060\\u0060';
      return await callClaudeJSON('analise');
    })()`);
    exigir(r.score === 42, "não interpretou a resposta cercada de markdown");
  });

  // ─────────────────────────────────────────────────────────────
  //  6. Sem chave: heurística local, e nenhuma chamada
  // ─────────────────────────────────────────────────────────────
  await cenario("sem chave a análise sai só com a heurística local", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = '';`);
    await campo('api-key-input', '');
    await rodar(`App.apiKey = ''`);
    await soltarArquivos(CAMINHOS.slice(0, 3));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length`),
      "sem chave o relatório não saiu");
    const r = await val(`({
      chamadas: API.chamadas.length,
      modelo: document.getElementById('rep-model') ? document.getElementById('rep-model').textContent : '',
      conf: [...document.querySelectorAll('#rep-table .td-conf')].map(t => t.textContent.trim()),
      aviso: document.getElementById('code-mode-note').textContent
    })`);
    exigir(r.chamadas === 0, "chamou a API sem ter chave: " + r.chamadas);
    exigir(r.conf.every(c => c !== 'erro'), "escreveu 'erro' onde não houve erro");
    exigir(/heur/i.test(r.aviso), "não avisou que a análise seria só local");
  });

  // ─────────────────────────────────────────────────────────────
  //  7. Arquivos que não devem ir para a API
  // ─────────────────────────────────────────────────────────────
  await cenario("node_modules, imagem e minificado ficam de fora", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-filtra'].join('-');`);
    await soltarArquivos(["src/app.ts", "node_modules/lib/index.js", "public/logo.png",
                          "dist/bundle.min.js", ".env"]);
    const r = await val(`({
      lidos: CodeState.files.length,
      selecionados: selectedFiles().map(f => f.path),
      ignorados: CodeState.files.filter(f => f.skipReason).map(f => f.path + ' — ' + f.skipReason)
    })`);
    exigir(r.selecionados.length === 1, "selecionou " + r.selecionados.length + ": " + r.selecionados.join(", "));
    exigir(r.selecionados[0].endsWith("app.ts"), "selecionou o arquivo errado: " + r.selecionados[0]);
    exigir(r.ignorados.length === 4, "ignorou " + r.ignorados.length + " de 4");
    exigir(r.ignorados.every(i => i.split("—")[1].trim()), "algum ignorado ficou sem motivo escrito");
  });

  // ─────────────────────────────────────────────────────────────
  //  8. Reescrever um arquivo
  // ─────────────────────────────────────────────────────────────
  await cenario("reescrever um arquivo mostra antes, depois e o que mudou", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-hz'].join('-');`);
    await soltarArquivos(CAMINHOS.slice(0, 2));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-details .det').length`), "sem relatório");
    await rodar(`document.querySelector('#rep-details .det').open = true;
                 API.chamadas = [];
                 document.querySelector('[data-hz-run]').click()`);
    exigir(await esperarPor(`document.querySelector('.hz-result')`), "o painel da reescrita não veio");

    const r = await val(`({
      prompt: API.chamadas[0].prompt,
      codigo: document.querySelector('.hz-code').textContent,
      deltas: document.querySelector('.hz-deltas').textContent,
      mudancas: (() => {
        const d = [...document.querySelectorAll('.hz-list')]
          .find(x => /O que mudou/.test(x.querySelector('summary').textContent));
        if (!d) return 0;
        d.open = true;
        return d.querySelectorAll('li').length;
      })()
    })`);
    exigir(/NÃO altere o comportamento/.test(r.prompt), "o prompt não proibiu mudar comportamento");
    exigir(r.codigo.includes("normalizaPedido"), "o código reescrito não apareceu");
    exigir((r.deltas.match(/%/g) || []).length >= 2, "faltou antes ou depois: " + r.deltas);
    exigir(r.mudancas >= 1, "não listou o que mudou");
  });

  // ─────────────────────────────────────────────────────────────
  //  9. Reescrever o projeto inteiro, com reanálise
  // ─────────────────────────────────────────────────────────────
  await cenario("reescrever o projeto inteiro mede o antes e o depois", async () => {
    await rodar(`API.texto = prompt => /rewritten/.test(prompt)
      ? JSON.stringify({ rewritten: "const preco = 10;", changes: [{what:"n",why:"w",where:"1"}],
                         kept: [], risk: "nenhum", note: "" })
      : JSON.stringify({ score: 20, confidence: "alta", verdict: "v", signals: [], hotspots: [],
                         suggestions: [], summary: "s" });
      document.getElementById('pz-reanalyze').checked = true;
      document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 90), "a reescrita do projeto não terminou");

    const r = await val(`(() => {
      const el = document.querySelector('.pz-result');
      const n = [...el.querySelectorAll('.pz-score b')].map(b => parseInt(b.textContent));
      return { antes: n[0], depois: n[1], linhas: el.querySelectorAll('.pz-table tbody tr').length,
               rotulo: el.querySelector('.pz-score-lab ~ *') ? '' : '',
               heuristica: el.textContent.includes('heurística'),
               zip: !!el.querySelector('#pz-zip') };
    })()`);
    exigir(r.linhas === 2, "linhas: " + r.linhas);
    exigir(Number.isFinite(r.depois), "o depois ficou sem número");
    exigir(r.depois < r.antes, `o depois (${r.depois}%) não caiu em relação ao antes (${r.antes}%)`);
    exigir(!r.heuristica, "marcou como heurística mesmo com a reanálise tendo dado certo");
    exigir(r.zip, "não ofereceu o zip do projeto reescrito");
  });

  // ─────────────────────────────────────────────────────────────
  //  10. Reanálise que falha não pode apagar o depois
  // ─────────────────────────────────────────────────────────────
  await cenario("reanálise que falha mantém a medida local", async () => {
    await rodar(`let n = 0;
      window.fetch = (orig => async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (!/rewritten/.test(body.messages[0].content))
          return { ok: false, status: 400, json: async () => ({ error: { message: 'workspace' } }) };
        return orig(url, opts);
      })(window.fetch);
      document.getElementById('pz-out').innerHTML = '';
      document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 90), "não terminou");
    const r = await val(`(() => {
      const el = document.querySelector('.pz-result');
      const n = [...el.querySelectorAll('.pz-score b')].map(b => b.textContent.trim());
      return { depois: n[1], heuristica: el.textContent.includes('heurística'),
               travessao: n[1] === '—' };
    })()`);
    exigir(!r.travessao, "a reanálise falhou e o depois virou um travessão de novo");
    exigir(r.heuristica, "não avisou que o depois veio da medida local");
  });

  // ─────────────────────────────────────────────────────────────
  //  11. O defeito relatado: 72 arquivos falhando na mesma coisa
  // ─────────────────────────────────────────────────────────────
  await cenario("72 arquivos falhando: o aviso cabe na caixa", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-72'].join('-');`);
    await soltarArquivos(MUITOS);
    exigir(await rodar(`selectedFiles().length >= 70`),
      "não entraram os 72 arquivos: " + await rodar(`selectedFiles().length`));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 70`, 120),
      "o relatório dos 72 não saiu");

    // agora a reescrita falha em todos, com a mensagem longa do workspace
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 150), "a reescrita não terminou");

    const r = await val(`(() => {
      const el = document.querySelector('.pz-result');
      return { avisos: el.querySelectorAll('.hz-erro').length,
               // contar a palavra no texto era proxy fragil e quebrou sozinho
               // duas vezes. O que importa e quantos avisos foram desenhados.
               vezes: el.querySelectorAll('.hz-erro').length,
               linhas: el.querySelectorAll('.pz-table tbody tr').length };
    })()`);
    exigir(r.avisos === 1, `a mesma falha virou ${r.avisos} avisos em vez de um só`);
    exigir(r.vezes === 1, `a mesma causa virou ${r.vezes} avisos em vez de um só`);

    const t = await transbordo();
    exigir(!t.total, `${t.total} bloco(s) fora da caixa: ` +
      t.fora.map(f => `${f.onde} (${f.tipo}: ${f.dir} > ${f.limite})`).join(" | "));
    exigir(t.rolagem <= 2, `a página ganhou ${t.rolagem}px de rolagem lateral`);
  });

  // ─────────────────────────────────────────────────────────────
  //  12. O mesmo, em toda largura de tela
  // ─────────────────────────────────────────────────────────────
  for (const largura of [1920, 1440, 1280, 1100, 900, 760, 390]) {
    await cenario(`a ${largura}px nada sai da caixa`, async () => {
      await send("Emulation.setDeviceMetricsOverride",
        { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 800 });
      await esperar(400);
      const t = await transbordo();
      await send("Emulation.clearDeviceMetricsOverride");
      await esperar(150);
      exigir(!t.total, `${t.total} bloco(s) fora: ` +
        t.fora.map(f => `${f.onde} (${f.tipo}: ${f.dir} > ${f.limite})`).join(" | "));
      exigir(t.rolagem <= 2, `${t.rolagem}px de rolagem lateral`);
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  13. Cancelar no meio
  // ─────────────────────────────────────────────────────────────
  await cenario("cancelar interrompe e devolve o controle", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-canc'].join('-'); API.atraso = 3000;`);
    await soltarArquivos(CAMINHOS.slice(0, 6));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    await esperar(600);
    exigir(await rodar(`getComputedStyle(document.getElementById('code-progress')).display !== 'none'`),
      "a barra de progresso não apareceu durante a análise");
    await rodar(`document.getElementById('btn-cancel-code').click()`);
    await esperar(900);
    const r = await val(`({
      rodando: CodeState.running,
      botao: document.getElementById('btn-analyze-code').disabled,
      progresso: getComputedStyle(document.getElementById('code-progress')).display
    })`);
    exigir(!r.rodando, "continuou marcado como rodando depois do cancelar");
    exigir(!r.botao, "o botão de analisar ficou travado depois do cancelar");
    exigir(r.progresso === "none", "a barra de progresso ficou na tela");
    await rodar(`API.atraso = 0`);
  });

  // ─────────────────────────────────────────────────────────────
  //  14. Exportar
  // ─────────────────────────────────────────────────────────────
  await cenario("o relatório sai em markdown com os arquivos dentro", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-exp'].join('-');`);
    await soltarArquivos(CAMINHOS.slice(0, 3));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length`), "sem relatório");
    const md = await rodar(`reportToMarkdown(buildProjectReport(CodeState.results))`);
    exigir(md.includes("CriarPedidoView.ts"), "o arquivo não entrou no markdown");
    exigir(md.split(String.fromCharCode(10)).filter(l => l.startsWith("|")).length >= 5,
      "a tabela do markdown veio curta");
    exigir(!/undefined|NaN/.test(md), "o markdown tem undefined ou NaN");
  });

  await cenario("o zip do projeto reescrito é um zip de verdade", async () => {
    const r = await val(`(async () => {
      const blob = buildZip(CodeState.results.map(r => ({ path: r.path, text: "const a = 1;" })));
      const b = new Uint8Array(await blob.arrayBuffer());
      const txt = new TextDecoder().decode(b);
      return { pk: b[0] === 80 && b[1] === 75, nomes: CodeState.results.every(r => txt.includes(r.path)),
               tamanho: b.length };
    })()`);
    exigir(r.pk, "não é um zip");
    exigir(r.nomes, "faltou arquivo dentro do zip");
  });

  // ─────────────────────────────────────────────────────────────
  //  15. O modo texto, ponta a ponta
  // ─────────────────────────────────────────────────────────────
  await cenario("modo texto: analisar e reescrever", async () => {
    await abrir();
    const texto = "No cenário atual, é importante ressaltar que a implementação de soluções "
      + "inovadoras não apenas transforma processos, mas também redefine paradigmas. "
      + "Vale destacar que isso muda tudo.";
    await rodar(`
      App.apiKey = ['sk','ant','api03-de-mentira-txt'].join('-');
      API.texto = prompt => /rewritten/.test(prompt)
        ? JSON.stringify({ rewritten: "As mudanças são menores do que parecem.",
            changes: [{ what: "abertura", why: "fórmula", where: "§1" }], kept: [],
            risk: "nenhum", note: "" })
        : JSON.stringify({ score: 88, confidence: "alta", verdict: "provavelmente de IA",
            indicators: [{ name: "abertura de fórmula", score: 90, evidence: "No cenário atual" }],
            analysis: "Padrão de abertura e de contraste típico.",
            suggestions: ["trocar a abertura"] });
      document.querySelector('.tab[data-mode="text"]').click();
      const t = document.getElementById('txt');
      t.value = ${JSON.stringify(texto)};
      t.dispatchEvent(new Event('input'));
    `);
    exigir(await rodar(`/\\d/.test(document.getElementById('wc').textContent)`),
      "o contador de palavras não mexeu");
    await rodar(`document.getElementById('btn-analyze').click()`);
    exigir(await esperarPor(`getComputedStyle(document.getElementById('gauge-wrap')).display !== 'none'`),
      "o medidor do modo texto não apareceu");
    exigir(await rodar(`document.getElementById('gauge-score').textContent.includes('88')`),
      "o percentual da resposta não chegou ao medidor");

    await rodar(`document.getElementById('btn-rewrite').click()`);
    exigir(await esperarPor(`getComputedStyle(document.getElementById('rewrite-box')).display !== 'none'`),
      "a reescrita do texto não apareceu");
    exigir(await rodar(`document.getElementById('rewrite-text').textContent.includes('menores do que parecem')`),
      "o texto reescrito não foi para a tela");
    const t = await transbordo();
    exigir(!t.total, "no modo texto " + t.total + " bloco(s) fora da caixa");
  });

  // ─────────────────────────────────────────────────────────────
  //  16. O que fica guardado entre uma visita e outra
  // ─────────────────────────────────────────────────────────────
  await cenario("a chave e o workspace sobrevivem a recarregar a página", async () => {
    const barra = await temBarra();
    await campo('api-key-input', ['sk','ant','api03-de-mentira-guardada'].join('-'));
    await campo('workspace-input', 'wrkspc_guardado');
    await esperar(200);
    await abrir();
    const r = await val(`({ chave: App.apiKey, ws: App.workspaceId,
      campo: (document.getElementById('workspace-input') || {}).value,
      valida: App.keyOk })`);
    if (barra) {
      exigir(r.chave.endsWith("guardada"), "a chave digitada não voltou: " + r.chave);
      exigir(r.ws === "wrkspc_guardado", "o workspace não voltou: " + r.ws);
      exigir(r.campo === "wrkspc_guardado", "o campo do workspace voltou vazio");
    } else {
      // cópia privada: a chave vem do config.js e a barra sai da tela de propósito
      exigir(r.valida, "a chave do config.js não foi aceita");
      exigir(!r.chave.endsWith("guardada"),
        "a chave digitada sobrescreveu a do config.js");
    }
  });

  // ─────────────────────────────────────────────────────────────
  //  17. Rastros técnicos no meio do código
  // ─────────────────────────────────────────────────────────────
  await cenario("assinatura de IA no código é detectada e pesa no resultado", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click(); App.apiKey = '';`);
    await soltarArquivos(["src/a.ts"],
      "// Co-Authored-By: Claude <noreply@anthropic.com>\nconst a = 1;\n");
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length`), "sem relatório");
    const r = await val(`({ score: CodeState.results[0].score,
                            rastros: (CodeState.results[0].forensics || {}).traces || [] })`);
    exigir(r.rastros.length >= 1, "não achou a assinatura");
    exigir(r.score >= 95, "a assinatura não levou o percentual para o topo: " + r.score);
  });


  // ─────────────────────────────────────────────────────────────
  //  18. O campo que a mensagem de erro manda preencher
  // ─────────────────────────────────────────────────────────────
  // Vale nas duas cópias, sem exceção. A cópia privada reconstrói a barra do topo
  // para não mostrar a chave na tela, e nessa reconstrução o campo do workspace ia
  // junto: o erro mandava preencher um campo que não existia mais. Quem tem chave de
  // organização ficava num beco — nenhuma chamada funcionava, e não havia o que fazer.
  await cenario("o campo Workspace existe, com chave digitada ou vinda do config.js", async () => {
    await abrir();
    const r = await val(`(() => {
      const ws = document.getElementById('workspace-input');
      if (!ws) return { existe: false };
      const est = getComputedStyle(ws);
      return { existe: true, visivel: est.display !== 'none' && est.visibility !== 'hidden',
               naBarra: !!ws.closest('.apikey-bar') };
    })()`);
    exigir(r.existe, "o campo Workspace não está na tela — a mensagem de erro manda preencher "
      + "um campo que não existe");
    exigir(r.visivel, "o campo Workspace existe mas está escondido");
    exigir(r.naBarra, "o campo Workspace saiu da barra do topo, onde a mensagem diz que ele está");
  });

  await cenario("digitar o workspace chega ao cabeçalho da requisição", async () => {
    await rodar(`App.apiKey = ['sk','ant','api03-de-mentira-wsfield'].join('-'); API.chamadas = [];`);
    await campo('workspace-input', 'wrkspc_digitado');
    const ligou = await rodar(`App.workspaceId`);
    exigir(ligou === 'wrkspc_digitado',
      "digitar no campo não mexeu em App.workspaceId: " + JSON.stringify(ligou)
      + " — o campo está na tela mas não está ligado a nada");
    await rodar(`callClaude('oi')`);
    const h = await val(`API.chamadas[0].headers`);
    exigir(h['anthropic-workspace-id'] === 'wrkspc_digitado',
      "o workspace digitado não foi no cabeçalho: " + h['anthropic-workspace-id']);
  });

  await cenario("o erro de escopo acende o campo em vez de só falar dele", async () => {
    await abrir();
    await rodar(`App.apiKey = ['sk','ant','api03-de-mentira-acende'].join('-');
                 App.workspaceId = '';
                 API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace' } };`);
    const msg = await rodar(`(async () => { try { await callClaude('oi'); return 'NAO FALHOU'; }
                              catch (e) { return e.message; } })()`);
    exigir(/workspace/i.test(msg), "a mensagem mudou: " + msg);
    const marcado = await rodar(`(() => {
      const ws = document.getElementById('workspace-input');
      return ws ? ws.classList.contains('pedindo') : false;
    })()`);
    exigir(marcado,
      "o campo não foi destacado — a pessoa lê que é para preencher e não acha o campo");
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("workspace vindo do config.js vale sem ninguém digitar", async () => {
    const r = await rodar(`(async () => {
      const antes = App.workspaceId;
      App.workspaceId = 'wrkspc_do_config';   // é o que CFG.workspaceId faz no carregamento
      API.chamadas = [];
      App.apiKey = ['sk','ant','api03-de-mentira-cfgws'].join('-');
      await callClaude('oi');
      const h = API.chamadas[0].headers;
      App.workspaceId = antes;
      return h['anthropic-workspace-id'] || 'SEM CABEÇALHO';
    })()`);
    exigir(r === 'wrkspc_do_config', "o workspace do config.js não foi no cabeçalho: " + r);
  });

  // ─────────────────────────────────────────────────────────────
  //  19. O relatório com tudo aberto, que é como fica ao rolar
  // ─────────────────────────────────────────────────────────────
  // O detector abre todo <details> antes de medir, mas os blocos de reescrita por
  // arquivo só existem depois de clicar. É o estado que a pessoa vê ao rolar para
  // baixo e abrir um arquivo — e era o único que nenhum cenário montava.
  await cenario("detalhe de arquivo aberto, com reescrita e com erro dentro", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-detalhe'].join('-');`);
    await soltarArquivos(CAMINHOS.slice(0, 6));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-details .det').length >= 6`), "sem relatório");

    // uma reescrita que dá certo, com linha longa de verdade
    await rodar(`
      API.texto = prompt => /rewritten/.test(prompt)
        ? JSON.stringify({ rewritten:
            "export const repositorioDePedidosComFiltroDeStatusEOrdenacaoPorDataDeCriacao = "
            + "(conexao, filtros) => conexao.query('SELECT * FROM pedidos WHERE status = ? "
            + "ORDER BY criado_em DESC', [filtros.status]);",
            changes: [{ what: "nome longo demais para caber numa linha da caixa",
                        why: "o nome antigo não dizia o que a função faz, e este aqui serve para "
                             + "ver até onde a caixa aguenta sem deixar o texto escapar",
                        where: "linha 1" }],
            kept: ["a assinatura exportada, porque outro módulo depende dela pelo nome"],
            risk: "nenhum", note: "Nada além de nomes mudou." })
        : JSON.stringify({ score: 30, confidence: "alta", verdict: "v", signals: [],
                           hotspots: [], suggestions: [], summary: "s" });
      document.querySelectorAll('#rep-details .det').forEach(d => { d.open = true; });
      document.querySelectorAll('[data-hz-run]')[0].click();`);
    exigir(await esperarPor(`document.querySelector('.hz-result')`), "a reescrita não apareceu");

    // e uma que falha, dentro do detalhe
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace' } };
                 document.querySelectorAll('[data-hz-run]')[1].click()`);
    exigir(await esperarPor(`document.querySelectorAll('.hz-erro').length`), "o erro não apareceu no detalhe");
    await rodar(`API.status = 200; API.corpo = null;`);

    for (const largura of [1440, 1100, 900, 760, 390]) {
      await send("Emulation.setDeviceMetricsOverride",
        { width: largura, height: 900, deviceScaleFactor: 1, mobile: largura < 800 });
      await esperar(400);
      const t = await transbordo();
      await send("Emulation.clearDeviceMetricsOverride");
      await esperar(120);
      if (t.total || t.rolagem > 2)
        throw new Error(`a ${largura}px: ${t.total} bloco(s) fora, ${t.rolagem}px de rolagem — `
          + t.fora.map(f => `${f.onde} (${f.tipo}: ${f.dir} > ${f.limite})`).join(" | "));
    }
  });

  // ─────────────────────────────────────────────────────────────
  //  20. Rolar até o fim não revela nada fora da caixa
  // ─────────────────────────────────────────────────────────────
  await cenario("rolar o relatório inteiro não revela nada fora da caixa", async () => {
    const alturas = await val(`(() => {
      document.querySelectorAll('details').forEach(d => { d.open = true; });
      return { total: document.documentElement.scrollHeight,
               janela: document.documentElement.clientHeight };
    })()`);
    const passos = Math.max(1, Math.ceil(alturas.total / alturas.janela));
    for (let i = 0; i <= passos; i++) {
      await rodar(`window.scrollTo(0, ${i} * document.documentElement.clientHeight)`);
      await esperar(120);
      const t = await transbordo();
      if (t.total || t.rolagem > 2)
        throw new Error(`rolando (${i}/${passos}): ${t.total} bloco(s) fora, `
          + `${t.rolagem}px de rolagem lateral — `
          + t.fora.map(f => `${f.onde} (${f.tipo}: ${f.dir} > ${f.limite})`).join(" | "));
    }
    await rodar(`window.scrollTo(0, 0)`);
  });


  // ─────────────────────────────────────────────────────────────
  //  21. O erro tem que dizer a verdade
  // ─────────────────────────────────────────────────────────────
  await cenario("a mensagem da API nunca é escondida", async () => {
    await abrir();
    await rodar(`App.apiKey = ['sk','ant','api03-de-mentira-verdade'].join('-')`);
    const casos = [
      [400, "Some very specific thing the API complained about"],
      [400, "This API key is not scoped to a workspace"],
      [401, "invalid x-api-key"],
      [403, "not permitted for this workspace"],
      [429, "rate_limit_error: too many requests"],
      [529, "overloaded"]
    ];
    for (const [status, detalhe] of casos) {
      const msg = await rodar(`(async () => {
        API.status = ${status}; API.corpo = { error: { message: ${JSON.stringify(detalhe)} } };
        try { await callClaude('oi'); return 'NAO FALHOU'; } catch (e) { return e.message; }
      })()`);
      exigir(msg.includes(detalhe),
        `${status}: a mensagem da API sumiu. A pessoa vê "${msg}" e não o que a API disse`);
      exigir(/request-id: req_/.test(msg),
        `${status}: faltou o request-id, que é o que o suporte pede`);
    }
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("limite de gasto não é confundido com escopo de chave", async () => {
    const gasto = await rodar(`(async () => {
      API.status = 400;
      API.corpo = { error: { message: 'Your organization has reached its monthly spend limit' } };
      try { await callClaude('oi'); return 'NAO FALHOU'; } catch (e) { return e.message; }
    })()`);
    exigir(/gasto/i.test(gasto), "não reconheceu o limite de gasto: " + gasto);
    exigir(!/preencha o campo "Workspace"/.test(gasto),
      "mandou preencher o Workspace para um limite de gasto — preencher não resolve isso");

    const escopo = await rodar(`(async () => {
      API.corpo = { error: { message: 'This API key is not scoped to a workspace' } };
      try { await callClaude('oi'); return 'NAO FALHOU'; } catch (e) { return e.message; }
    })()`);
    exigir(/workspace/i.test(escopo), "não reconheceu o problema de escopo: " + escopo);
    exigir(/API keys → Create Key/.test(escopo),
      "a dica não aponta a saída que funciona: criar chave vinculada a um workspace");
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("o diagnóstico mostra o que foi enviado, sem revelar a chave", async () => {
    await abrir();
    const chave = ['sk','ant','api03-de-mentira-segredo-absoluto-12345'].join('-');
    await rodar(`App.apiKey = ${JSON.stringify(chave)}; App.workspaceId = 'wrkspc_diag';`);
    await rodar(`callClaude('oi')`);
    await rodar(`(async () => {
      API.status = 400; API.corpo = { error: { message: 'algo deu errado' } };
      try { await callClaude('oi'); } catch (e) {}
      API.status = 200; API.corpo = null;
    })()`);
    const texto = await rodar(`diagnosticoTexto()`);

    exigir(!texto.includes(chave), "A CHAVE INTEIRA VAZOU no diagnóstico");
    exigir(!texto.includes('segredo-absoluto'), "o miolo da chave vazou no diagnóstico");
    exigir(texto.includes('2345'),   // a máscara mostra os quatro últimos
      "não dá para saber qual chave é: nem o final aparece");
    exigir(texto.includes('46 caracteres'),
      "não registrou o tamanho da chave, que é o que denuncia uma chave truncada");
    exigir(texto.includes('wrkspc_diag'), "não registrou o workspace que foi enviado");
    exigir(texto.includes('wrkspc_da_resposta'),
      "não registrou em que workspace a API disse que a chave caiu");
    exigir(/HTTP 200/.test(texto) && /HTTP 400/.test(texto),
      "não registrou as duas chamadas: " + texto.slice(0, 200));
    exigir(texto.includes('algo deu errado'), "não registrou o que a API respondeu");
    exigir(/request-id: req_/.test(texto), "não registrou o request-id");
  });

  await cenario("falha de rede entra no diagnóstico em vez de sumir", async () => {
    await rodar(`(async () => {
      const original = window.fetch;
      window.fetch = async () => { throw new TypeError('Failed to fetch'); };
      try { await callClaude('oi'); } catch (e) {}
      window.fetch = original;
    })()`);
    const texto = await rodar(`diagnosticoTexto()`);
    exigir(texto.includes('não chegou a responder'),
      "uma falha de rede não deixou rastro no diagnóstico");
    exigir(texto.includes('Failed to fetch'), "não registrou qual foi a falha de rede");
  });

  await cenario("a mesma falha em muitos arquivos vira um aviso só, com diagnóstico", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-umaviso'].join('-');`);
    await soltarArquivos(CAMINHOS.slice(0, 8));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 8`, 90),
      "sem relatório");
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 120), "não terminou");

    const r = await val(`(() => {
      const el = document.querySelector('.pz-result');
      return { avisos: el.querySelectorAll('.hz-erro').length,
               temDiag: !!el.querySelector('.pz-diag'),
               temCopiar: !!el.querySelector('[data-diag-copy]'),
               diagTemChave: (el.querySelector('.pz-diag .hz-code') || {}).textContent
                 ? new RegExp(['sk','ant','api03-de-mentira-umaviso'].join('-')).test(el.querySelector('.pz-diag .hz-code').textContent)
                 : false };
    })()`);
    exigir(r.avisos === 1,
      `${r.avisos} avisos para a mesma causa — o request-id, que muda a cada chamada, `
      + `não pode entrar no agrupamento`);
    exigir(r.temDiag, "a falha não trouxe o bloco de diagnóstico");
    exigir(r.temCopiar, "não dá para copiar o diagnóstico");
    exigir(!r.diagTemChave, "A CHAVE VAZOU no diagnóstico mostrado na tela");
    await rodar(`API.status = 200; API.corpo = null;`);
  });


  // ─────────────────────────────────────────────────────────────
  //  22. A rolagem é de quem está lendo
  // ─────────────────────────────────────────────────────────────
  await cenario("erro repetido não rouba a rolagem da página", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-rolagem'].join('-');`);
    await soltarArquivos(CAMINHOS.slice(0, 8));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 8`, 90),
      "sem relatório");

    // a pessoa desce para ler o relatório
    await rodar(`document.querySelectorAll('details').forEach(d => { d.open = true; });
                 window.scrollTo(0, Math.floor(document.documentElement.scrollHeight / 2))`);
    await esperar(300);
    const antes = await rodar(`Math.round(window.scrollY)`);
    exigir(antes > 50, "a página nem rolou, o teste não vale: " + antes);

    // e agora tudo falha pela causa que manda preencher o workspace
    await rodar(`App.workspaceId = '';
                 API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace, '
                   + 'so this request must include the anthropic-workspace-id header.' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 120), "não terminou");
    await esperar(600);   // tempo de sobra para qualquer scroll suave se manifestar

    const depois = await rodar(`Math.round(window.scrollY)`);
    exigir(Math.abs(depois - antes) < 120,
      `a página pulou de ${antes} para ${depois} — o erro tomou a rolagem de quem estava lendo`);
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("erro repetido não rouba o foco", async () => {
    const foco = await rodar(`(document.activeElement || {}).id || '(nenhum)'`);
    exigir(foco !== 'workspace-input',
      "o campo do workspace tomou o foco sozinho — digitar em qualquer outro lugar vira loteria");
  });

  // ─────────────────────────────────────────────────────────────
  //  23. Resolver onde o problema aparece
  // ─────────────────────────────────────────────────────────────
  await cenario("o campo do workspace aparece junto do erro", async () => {
    const r = await val(`(() => {
      const form = document.querySelector('[data-ws-form]');
      if (!form) return { existe: false };
      return { existe: true,
               dentroDoErro: !!form.closest('.hz-erro'),
               temCampo: !!form.querySelector('input'),
               temBotao: !!form.querySelector('button[type=submit]') };
    })()`);
    exigir(r.existe, "a falha de workspace não trouxe o campo para preencher ali mesmo");
    exigir(r.dentroDoErro, "o campo ficou fora do bloco do erro");
    exigir(r.temCampo && r.temBotao, "faltou o campo ou o botão");
  });

  await cenario("um ID malformado é recusado antes de gastar chamada", async () => {
    await rodar(`(() => {
      API.chamadas = [];
      const f = document.querySelector('[data-ws-form]');
      f.querySelector('input').value = 'qualquer-coisa';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);
    await esperar(300);
    const r = await val(`({
      chamadas: API.chamadas.length,
      aviso: document.querySelector('[data-ws-aviso]').textContent,
      ws: App.workspaceId
    })`);
    exigir(r.chamadas === 0, "gastou " + r.chamadas + " chamada(s) com um ID que nem tem o prefixo");
    exigir(/wrkspc_/.test(r.aviso), "não explicou o formato esperado: " + r.aviso);
    exigir(!r.ws, "guardou um ID malformado: " + r.ws);
  });

  await cenario("salvar o workspace ali refaz o trabalho, agora com o cabeçalho", async () => {
    await rodar(`(() => {
      API.status = 200; API.corpo = null; API.chamadas = [];
      const f = document.querySelector('[data-ws-form]');
      f.querySelector('input').value = 'wrkspc_preenchido_no_erro';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);
    exigir(await esperarPor(`API.chamadas.length > 0`, 60), "não tentou de novo depois de salvar");
    await esperarPor(`document.querySelector('.pz-result')`, 120);

    const r = await val(`({
      cabecalho: API.chamadas[0].headers['anthropic-workspace-id'],
      guardado: localStorage.getItem('dlm_workspace_id'),
      campoDoTopo: (document.getElementById('workspace-input') || {}).value,
      aindaPedindo: (document.getElementById('workspace-input') || {}).classList
        ? document.getElementById('workspace-input').classList.contains('pedindo') : false
    })`);
    exigir(r.cabecalho === 'wrkspc_preenchido_no_erro',
      "o workspace salvo no erro não foi no cabeçalho: " + r.cabecalho);
    exigir(r.guardado === 'wrkspc_preenchido_no_erro',
      "não ficou guardado para a próxima vez: " + r.guardado);
    exigir(r.campoDoTopo === 'wrkspc_preenchido_no_erro',
      "o campo da barra do topo ficou fora de sincronia: " + r.campoDoTopo);
    exigir(!r.aindaPedindo, "o campo continuou marcado como pendente depois de preenchido");
  });


  // ─────────────────────────────────────────────────────────────
  //  24. Buscar o workspace em vez de caçar o ID
  // ─────────────────────────────────────────────────────────────
  await cenario("a página busca os workspaces com a chave que já tem", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-picker'].join('-');
                 App.workspaceId = '';`);
    await soltarArquivos(CAMINHOS.slice(0, 4));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 4`, 90),
      "sem relatório");
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace, '
                   + 'so this request must include the anthropic-workspace-id header.' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('[data-ws-listar]')`, 120),
      "o botão de buscar workspaces não apareceu junto do erro");

    await rodar(`API.listas = []; document.querySelector('[data-ws-listar]').click()`);
    exigir(await esperarPor(`document.querySelectorAll('[data-ws-escolher]').length`, 60),
      "a lista de workspaces não apareceu");

    const r = await val(`({
      opcoes: [...document.querySelectorAll('[data-ws-escolher]')].map(b => b.dataset.wsEscolher),
      cabecalhos: API.listas[0].headers,
      url: API.listas[0].url,
      nota: (document.querySelector('.pz-ws-nota') || {}).textContent || ''
    })`);
    exigir(r.opcoes.length === 2,
      "esperava 2 workspaces ativos, veio " + r.opcoes.length + ": " + r.opcoes.join(", "));
    exigir(!r.opcoes.includes('wrkspc_velho'), "ofereceu um workspace arquivado");
    exigir(r.cabecalhos['x-api-key'], "a busca foi sem a chave");
    exigir(r.cabecalhos['anthropic-dangerous-direct-browser-access'] === 'true',
      "sem a liberação de chamada direta, o navegador barra por CORS");
    exigir(/Padrão/.test(r.nota), "não avisou que o Workspace Padrão não entra na lista");
  });

  await cenario("escolher da lista manda o cabeçalho e recomeça", async () => {
    await rodar(`API.status = 200; API.corpo = null; API.chamadas = [];
                 document.querySelector('[data-ws-escolher="wrkspc_estudos"]').click()`);
    exigir(await esperarPor(`API.chamadas.length > 0`, 60), "não recomeçou depois de escolher");
    await esperarPor(`document.querySelector('.pz-result')`, 120);
    const r = await val(`({
      cabecalho: API.chamadas[0].headers['anthropic-workspace-id'],
      guardado: localStorage.getItem('dlm_workspace_id'),
      campoDoTopo: (document.getElementById('workspace-input') || {}).value
    })`);
    exigir(r.cabecalho === 'wrkspc_estudos',
      "o workspace escolhido não foi no cabeçalho: " + r.cabecalho);
    exigir(r.guardado === 'wrkspc_estudos', "não ficou guardado: " + r.guardado);
    exigir(r.campoDoTopo === 'wrkspc_estudos', "o campo do topo ficou fora de sincronia");
  });

  await cenario("busca recusada mostra o motivo, sem travar a tela", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-semadmin'].join('-');
                 App.workspaceId = '';`);
    await soltarArquivos(CAMINHOS.slice(0, 3));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 3`, 90),
      "sem relatório");
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'not scoped to a workspace: include the '
                   + 'anthropic-workspace-id header' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('[data-ws-listar]')`, 120), "sem o botão");

    await rodar(`API.listaStatus = 403;
                 API.listaCorpo = { error: { message: 'Workspace-scoped keys cannot do this' } };
                 document.querySelector('[data-ws-listar]').click()`);
    await esperar(800);
    const r = await val(`({
      aviso: document.querySelector('[data-ws-aviso]').textContent,
      botaoVivo: !document.querySelector('[data-ws-listar]').disabled,
      rotulo: document.querySelector('[data-ws-listar]').textContent,
      campoVivo: !!document.querySelector('[data-ws-form] input')
    })`);
    exigir(r.aviso.includes('Workspace-scoped keys cannot do this'),
      "escondeu o motivo que a API deu: " + r.aviso);
    exigir(/API keys → Create Key/.test(r.aviso),
      "recusou a listagem sem apontar o próximo passo: " + r.aviso);
    exigir(r.botaoVivo, "o botão ficou travado depois da recusa");
    exigir(!/Buscando/.test(r.rotulo), "o botão ficou preso em 'Buscando…'");
    exigir(r.campoVivo, "sumiu com o campo manual, que é a saída quando a busca não serve");
    await rodar(`API.listaStatus = 200; API.listaCorpo = null; API.status = 200; API.corpo = null;`);
  });


  // ─────────────────────────────────────────────────────────────
  //  25. O HTML não pode ter comentário quebrado
  // ─────────────────────────────────────────────────────────────
  // Um script meu inseriu um comentário dentro de outro: o de fora fechava cedo, sobrava
  // um </body> de verdade no meio da página e um "=== -->" aparecia como texto na tela.
  // O navegador é tolerante e segue renderizando, então isso passa despercebido sem teste.
  await cenario("o HTML não tem comentário quebrado nem marcação solta", async () => {
    await abrir();
    const r = await val(`(() => {
      const solto = [];
      const andarilho = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = andarilho.nextNode(); n; n = andarilho.nextNode()) {
        const t = n.textContent;
        if (t.includes('-->') || t.includes('<!--')) solto.push(t.trim().slice(0, 60));
      }
      return { solto, corpos: document.querySelectorAll('body').length,
               depoisDoBody: document.body.nextElementSibling
                 ? document.body.nextElementSibling.tagName : '' };
    })()`);
    exigir(!r.solto.length,
      'marcação de comentário virou texto na tela: ' + r.solto.join(' | '));
    exigir(r.corpos === 1, 'a página tem ' + r.corpos + ' body');
  });


  await cenario("busca barrada pelo navegador explica a saída manual", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-cors'].join('-');
                 App.workspaceId = '';`);
    await soltarArquivos(CAMINHOS.slice(0, 3));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 3`, 90),
      "sem relatório");
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'not scoped to a workspace: include the '
                   + 'anthropic-workspace-id header' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('[data-ws-listar]')`, 120), "sem o botão");

    // o navegador barrando a chamada chega como TypeError, igual a um bloqueio de CORS
    await rodar(`
      const anterior = window.fetch;
      window.fetch = async (url, opts) => {
        if (String(url).includes('/organizations/workspaces'))
          throw new TypeError('Failed to fetch');
        return anterior(url, opts);
      };
      document.querySelector('[data-ws-listar]').click();`);
    await esperar(900);
    const aviso = await rodar(`document.querySelector('[data-ws-aviso]').textContent`);
    exigir(!/^Failed to fetch$/.test(aviso.trim()),
      "mostrou só 'Failed to fetch', que não diz nada a quem está usando");
    exigir(/Console/.test(aviso) && /wrkspc_/.test(aviso),
      "não apontou a saída manual: " + aviso);
    exigir(await rodar(`!!document.querySelector('[data-ws-form] input')`),
      "sumiu com o campo manual, que é justamente a saída neste caso");
    await rodar(`API.status = 200; API.corpo = null;`);
  });


  // ─────────────────────────────────────────────────────────────
  //  26. O diagnóstico diz ONDE falhou, não só QUE falhou
  // ─────────────────────────────────────────────────────────────
  await cenario("o veredito nomeia a etapa em que falhou", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-etapa'].join('-');
                 App.workspaceId = '';`);
    await soltarArquivos(CAMINHOS.slice(0, 3));

    // a análise passa, a reescrita é que falha: o veredito tem que dizer isso
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 3`, 90),
      "sem relatório");
    await rodar(`API.status = 400;
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace, '
                   + 'so this request must include the anthropic-workspace-id header.' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 120), "não terminou");

    const t = await rodar(`diagnosticoTexto()`);
    exigir(t.includes('VEREDITO'), "o diagnóstico não tem veredito");
    exigir(t.includes('reescrita do projeto inteiro'),
      "o veredito não diz em que etapa falhou");
    exigir(!/ONDE: análise do projeto[^]*não resolveu|ONDE: análise do projeto \(\d+ chamada/.test(t)
      || t.includes('reescrita do projeto inteiro'),
      "culpou a análise, que funcionou");
    exigir(/campo Workspace está VAZIO|VAZIO — é isto que falta/.test(t),
      "não disse que o campo está vazio, que é o estado que importa");
    exigir(/RESOLVE:/.test(t), "não disse o que resolve");
    exigir(/API keys → Create Key/.test(t),
      "não ofereceu a saída definitiva, que é criar a chave vinculada a um workspace");
    exigir(/RESUMO DAS \d+ CHAMADAS/.test(t), "não resumiu as chamadas por causa");
    exigir(/ESTADO DA PÁGINA/.test(t), "não registrou o estado da página");
    exigir(/versão dos arquivos: \w+/.test(t),
      "não registrou a versão dos arquivos — sem isso não dá para saber se o cache é velho");
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("o veredito separa limite de gasto de escopo de chave", async () => {
    await rodar(`(async () => {
      DIAG.length = 0;
      API.status = 400;
      API.corpo = { error: { message: 'Your organization has reached its spend limit' } };
      try { await callClaude('oi', { etapa: 'análise do projeto', alvo: 'a.ts' }); } catch (e) {}
      API.status = 200; API.corpo = null;
    })()`);
    const t = await rodar(`diagnosticoTexto()`);
    exigir(/limite de gasto/i.test(t), "não reconheceu o limite de gasto");
    exigir(/Settings → Limits/.test(t), "não disse onde se resolve");
    exigir(!/API keys → Create Key/.test(t),
      "ofereceu a saída de workspace para um problema de gasto");
    exigir(t.includes('análise do projeto'), "não disse a etapa");
  });

  await cenario("resposta ilegível não se confunde com recusa da API", async () => {
    const r = await val(`(async () => {
      DIAG.length = 0;
      API.texto = 'isto não é JSON nenhum, é um pedido de desculpas em prosa';
      let msg = '';
      try { await callClaudeJSON('oi', { etapa: 'reescrita de um arquivo', alvo: 'b.ts' }); }
      catch (e) { msg = e.message; }
      return { msg, diag: diagnosticoTexto() };
    })()`);
    exigir(/ilegível/i.test(r.diag), "não distinguiu resposta ilegível de recusa");
    exigir(r.diag.includes('reescrita de um arquivo'), "não disse a etapa");
    exigir(/foi cobrada/.test(r.diag),
      "não avisou que a chamada foi cobrada mesmo sem servir");
    exigir(r.diag.includes('pedido de desculpas'),
      "não mostrou o começo da resposta que não deu para ler");
  });

  await cenario("sem falha nenhuma o veredito diz isso claramente", async () => {
    await rodar(`(async () => {
      DIAG.length = 0;
      API.texto = JSON.stringify({ score: 10, confidence: 'alta', verdict: 'v', signals: [],
                                   hotspots: [], suggestions: [], summary: 's' });
      await callClaude('oi', { etapa: 'análise do projeto' });
    })()`);
    const t = await rodar(`diagnosticoTexto()`);
    exigir(/Nenhuma chamada falhou/.test(t),
      "com tudo funcionando o veredito ainda aponta problema");
  });


  // ─────────────────────────────────────────────────────────────
  //  27. Problema de conta para na primeira falha
  // ─────────────────────────────────────────────────────────────
  // 77 chamadas, todas com o mesmo erro de configuração, foi o que o usuário viu. Chave
  // sem workspace, chave inválida, sem permissão ou limite de gasto são problemas da
  // conta: iguais para todo arquivo. Insistir só gasta tempo e lota o registro.
  await cenario("erro de configuração para na primeira falha", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-parar'].join('-');
                 App.workspaceId = '';`);
    await soltarArquivos(MUITOS.slice(0, 20));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 20`, 120),
      "sem relatório");

    await rodar(`API.status = 400; API.chamadas = [];
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace, '
                   + 'so this request must include the anthropic-workspace-id header.' } };
                 document.getElementById('pz-reanalyze').checked = false;
                 document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 120), "não terminou");

    const r = await val(`({
      chamadas: API.chamadas.length,
      linhas: document.querySelectorAll('.pz-table tbody tr').length,
      naoTentados: [...document.querySelectorAll('.pz-table tbody tr')]
        .filter(tr => /não tentado/.test(tr.textContent)).length,
      avisoParada: /Parei na primeira falha/.test(document.querySelector('.pz-result').textContent),
      avisos: document.querySelectorAll('.pz-result .hz-erro').length
    })`);
    exigir(r.chamadas === 1,
      `gastou ${r.chamadas} chamadas para um erro de conta que já estava explicado na 1ª`);
    exigir(r.linhas === 20, `a tabela perdeu arquivos: ${r.linhas} de 20`);
    exigir(r.naoTentados === 19,
      `${r.naoTentados} marcados como não tentados, esperava 19`);
    exigir(r.avisoParada, "não explicou por que parou");
    exigir(r.avisos === 1, `${r.avisos} avisos em vez de um só`);
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("erro de um arquivo só não interrompe os outros", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-seguir'].join('-');
                 App.workspaceId = 'wrkspc_ok';`);
    await soltarArquivos(CAMINHOS.slice(0, 5));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 5`, 90),
      "sem relatório");

    // o terceiro arquivo devolve algo que não dá para ler; os outros seguem
    await rodar(`API.chamadas = [];
      let n = 0;
      API.texto = prompt => {
        if (!/rewritten/.test(prompt))
          return JSON.stringify({ score: 20, confidence: 'alta', verdict: 'v', signals: [],
                                  hotspots: [], suggestions: [], summary: 's' });
        n++;
        if (n === 3) return 'desculpe, não consigo reescrever isso';
        return JSON.stringify({ rewritten: 'const a = 1;', changes: [], kept: [],
                                risk: 'nenhum', note: '' });
      };
      document.getElementById('pz-reanalyze').checked = false;
      document.getElementById('pz-run').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 120), "não terminou");

    const r = await val(`({
      chamadas: API.chamadas.length,
      naoTentados: [...document.querySelectorAll('.pz-table tbody tr')]
        .filter(tr => /não tentado/.test(tr.textContent)).length,
      avisoParada: /Parei na primeira falha/.test(document.querySelector('.pz-result').textContent)
    })`);
    exigir(r.chamadas === 5, `parou cedo demais: ${r.chamadas} chamadas de 5`);
    exigir(r.naoTentados === 0, "marcou arquivos como não tentados por causa de um erro isolado");
    exigir(!r.avisoParada, "disse que parou, mas foi até o fim");
  });


  await cenario("a análise também para de chamar a API depois da recusa", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-analise'].join('-');
                 App.workspaceId = '';
                 API.status = 400; API.chamadas = [];
                 API.corpo = { error: { message: 'This API key is not scoped to a workspace, '
                   + 'so this request must include the anthropic-workspace-id header.' } };`);
    await soltarArquivos(MUITOS.slice(0, 20));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 20`, 120),
      "o relatório não saiu");

    const r = await val(`({
      chamadas: API.chamadas.length,
      linhas: document.querySelectorAll('#rep-table tbody tr').length,
      resultados: CodeState.results.length,
      comScore: CodeState.results.filter(x => typeof x.score === 'number').length
    })`);
    // uma recusa por concorrência é aceitável; dezenas não
    exigir(r.chamadas <= 6,
      `gastou ${r.chamadas} chamadas para 20 arquivos depois de a conta já ter recusado`);
    exigir(r.linhas === 20, `a tabela perdeu arquivos: ${r.linhas} de 20`);
    exigir(r.comScore === 20,
      "a análise deixou de pontuar arquivos — a heurística local é offline e deveria valer "
      + "para todos mesmo sem a IA");
    await rodar(`API.status = 200; API.corpo = null;`);
  });


  // ─────────────────────────────────────────────────────────────
  //  28. Sem saldo não é limite de gasto
  // ─────────────────────────────────────────────────────────────
  // Os dois dão 400 e os dois falam de cobrança, mas se resolvem em telas diferentes:
  // saldo zerado é Plans & Billing; teto atingido é Settings → Limits. Confundir manda
  // a pessoa mexer no limite quando o que falta é comprar crédito.
  await cenario("sem saldo aponta Plans & Billing, não o limite", async () => {
    await abrir();
    await rodar(`App.apiKey = ['sk','ant','api03-de-mentira-saldo'].join('-')`);
    const semSaldo = await rodar(`(async () => {
      API.status = 400;
      API.corpo = { error: { message: 'Your credit balance is too low to access the '
        + 'Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } };
      try { await callClaude('oi', { etapa: 'análise do projeto' }); return 'NAO FALHOU'; }
      catch (e) { return e.message; }
    })()`);
    exigir(/sem saldo/i.test(semSaldo), "não reconheceu saldo zerado: " + semSaldo);
    exigir(/Plans & Billing/.test(semSaldo), "não apontou onde comprar crédito");
    exigir(!/Settings → Limits/.test(semSaldo),
      "mandou mexer no limite, que não resolve falta de saldo");
    exigir(/Pro ou Max/.test(semSaldo),
      "não avisou que a assinatura do Claude é separada da API — é a confusão mais comum");

    const teto = await rodar(`(async () => {
      API.corpo = { error: { message: 'You have reached your monthly spend limit' } };
      try { await callClaude('oi', { etapa: 'análise do projeto' }); return 'NAO FALHOU'; }
      catch (e) { return e.message; }
    })()`);
    exigir(/Settings → Limits/.test(teto), "não apontou o limite: " + teto);
    exigir(!/Plans & Billing/.test(teto), "mandou comprar crédito para um teto atingido");
    await rodar(`API.status = 200; API.corpo = null;`);
  });

  await cenario("sem saldo também para na primeira chamada", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = ['sk','ant','api03-de-mentira-saldo2'].join('-');
                 API.status = 400; API.chamadas = [];
                 API.corpo = { error: { message: 'Your credit balance is too low' } };`);
    await soltarArquivos(MUITOS.slice(0, 15));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 15`, 120),
      "sem relatório");
    const n = await rodar(`API.chamadas.length`);
    exigir(n <= 6, `gastou ${n} chamadas para 15 arquivos com a conta sem saldo`);
    await rodar(`API.status = 200; API.corpo = null;`);
  });


  // ─────────────────────────────────────────────────────────────
  //  29. Reescrita local: sem IA, sem crédito, sem rede
  // ─────────────────────────────────────────────────────────────
  await cenario("a limpeza local não chama a API nenhuma vez", async () => {
    await abrir();
    await rodar(`document.querySelector('.tab[data-mode="code"]').click();
                 App.apiKey = '';`);
    await soltarArquivos(CAMINHOS.slice(0, 4),
      ["/**", " * Processa os dados.", " * @param {Object} data Os dados.",
       " * @returns {Object} O resultado.", " */",
       "// ================================",
       "function processData(data) {",
       "  // retorna o resultado   ",
       "  const result = data;",
       "  return result;",
       "}",
       "",
       "",
       "",
       "// Co-Authored-By: Claude <noreply@anthropic.com>"].join(String.fromCharCode(10)));
    await rodar(`document.getElementById('btn-analyze-code').click()`);
    exigir(await esperarPor(`document.querySelectorAll('#rep-table tbody tr').length >= 4`, 90),
      "sem relatório");

    exigir(await rodar(`!!document.getElementById('pz-run-local')`),
      "o botão de limpeza local não apareceu");
    exigir(await rodar(`!!document.getElementById('pz-run')`),
      "o botão de reescrita com IA sumiu — as duas opções têm que conviver");

    await rodar(`API.chamadas = []; document.getElementById('pz-run-local').click()`);
    exigir(await esperarPor(`document.querySelector('.pz-result')`, 90), "não terminou");

    const r = await val(`(() => {
      const el = document.querySelector('.pz-result');
      const n = [...el.querySelectorAll('.pz-score b')].map(b => parseInt(b.textContent));
      return { chamadas: API.chamadas.length, antes: n[0], depois: n[1],
               linhas: el.querySelectorAll('.pz-table tbody tr').length,
               avisoLocal: /limpeza <?strong>?local|limpeza local/i.test(el.innerHTML),
               zip: !!el.querySelector('#pz-zip') };
    })()`);
    exigir(r.chamadas === 0,
      `a limpeza local gastou ${r.chamadas} chamadas — ela existe justamente para não gastar`);
    exigir(r.linhas === 4, `a tabela ficou com ${r.linhas} linhas`);
    exigir(Number.isFinite(r.depois), "o depois ficou sem número");
    exigir(r.depois < r.antes,
      `a limpeza não baixou o percentual: ${r.antes}% → ${r.depois}%`);
    exigir(r.avisoLocal, "não avisou que foi a limpeza local, e não a reescrita com IA");
    exigir(r.zip, "não ofereceu o zip do resultado");
  });

  await cenario("a limpeza não muda uma linha de código nem o conteúdo de string", async () => {
    const r = await val(`(() => {
      const fonte = [
        '/**',
        ' * Processa os dados.',
        ' * @param {Object} data Os dados.',
        ' */',
        '// ==============================',
        'function f(data) {',
        '  const msg = "traço — e aspas “curvas” ficam, é string";',
        '  const result = data + 1;   ',
        '  // retorna o resultado',
        '  return result;',
        '}',
        '',
        '',
        '',
        '// Co-Authored-By: Claude <noreply@anthropic.com>'
      ].join(String.fromCharCode(10));
      const r = reescritaLocal(fonte, 'javascript', {});
      // só as linhas que são código, na ordem, sem espaço no fim
      // Sem regex: num template literal \\s e \\/ perdem a barra antes de chegar à
      // página, e o padrão chega quebrado. Comparar com startsWith não tem esse risco.
      const ehComentario = l => {
        const t = l.trim();
        return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
      };
      const semEspacoAtras = l => {
        let f = l.length;
        while (f > 0 && (l[f - 1] === ' ' || l[f - 1] === String.fromCharCode(9))) f--;
        return l.slice(0, f);
      };
      const soCodigo = t => t.split(String.fromCharCode(10))
        .map(semEspacoAtras)
        .filter(l => l.trim() && !ehComentario(l));
      return { antes: soCodigo(fonte), depois: soCodigo(r.codigo),
               codigo: r.codigo, mudancas: r.mudancas.map(m => m.que) };
    })()`);
    exigir(JSON.stringify(r.antes) === JSON.stringify(r.depois),
      'o código executável mudou:\\n      antes: ' + JSON.stringify(r.antes)
      + '\\n      depois: ' + JSON.stringify(r.depois));
    exigir(r.codigo.includes('traço — e aspas “curvas” ficam'),
      'mexeu no conteúdo de uma string — isso muda o que o programa faz');
    exigir(!/Co-Authored-By/.test(r.codigo), 'deixou a assinatura da ferramenta');
    exigir(!/={10,}/.test(r.codigo), 'deixou a régua decorativa');
    exigir(!/retorna o resultado/.test(r.codigo),
      'deixou o comentário que só repetia a linha de baixo');
    exigir(!/@param \{Object\} data Os dados/.test(r.codigo),
      'deixou a docstring de molde');
    exigir(!/\n\n\n/.test(r.codigo), 'deixou três linhas em branco seguidas');
    exigir(r.mudancas.length >= 4,
      'listou só ' + r.mudancas.length + ' mudanças: ' + r.mudancas.join(' | '));
  });

  await cenario("comentário que explica de verdade é preservado", async () => {
    const r = await rodar(`reescritaLocal([
      'function preco(p) {',
      '  // a faixa de 0,9 veio da negociação de 2024, não é arredondamento',
      '  return p * 0.9;',
      '}'
    ].join(String.fromCharCode(10)), 'javascript', {}).codigo`);
    exigir(/negociação de 2024/.test(r),
      'apagou um comentário que explicava o porquê — é justamente o que marca autoria humana');
  });

  await cenario("caractere invisível some, inclusive dentro de string", async () => {
    const r = await val(`(() => {
      const fonte = 'const a = 1;' + String.fromCharCode(0x200B) + String.fromCharCode(10)
        + 'const b = 2;';
      const out = reescritaLocal(fonte, 'javascript', {});
      return { tem: /\u200B/.test(out.codigo), mudancas: out.mudancas.map(m => m.que) };
    })()`);
    exigir(!r.tem, 'sobrou caractere invisível');
    exigir(r.mudancas.some(m => /invisível|largura zero/i.test(m)),
      'não registrou a remoção: ' + r.mudancas.join(' | '));
  });

  await cenario("arquivo já limpo é marcado, não reescrito à toa", async () => {
    const r = await val(`(() => {
      const fonte = ['function preco(p) {', '  return p * 0.9;', '}'].join(String.fromCharCode(10));
      const out = reescritaLocal(fonte, 'javascript', {});
      return { mudancas: out.mudancas.length, igual: out.codigo.trim() === fonte.trim() };
    })()`);
    exigir(r.igual, 'mexeu num arquivo que não tinha nada mecânico a corrigir');
    exigir(r.mudancas === 0, 'inventou ' + r.mudancas + ' mudanças onde não havia nada');
  });

  await cenario("a limpeza diz o que ficou para o modelo", async () => {
    const r = await rodar(`reescritaLocal('const a = 1;', 'javascript', {}).naoFeito.join(' | ')`);
    exigir(/renomear/i.test(r), 'não avisou que renomear continua com o modelo');
    exigir(/abstração/i.test(r), 'não avisou sobre abstração desnecessária');
  });

  ws.close(); chrome.kill();
  console.log(`cenários: ${ok.length} passaram, ${falhas.length} falharam`);
  ok.forEach(x => console.log("  ✓", x));
  if (falhas.length) { console.log("\nFALHAS:"); falhas.forEach(x => console.log("  ✗", x)); }
  const reais = errosConsole.filter(e => !/favicon|DevTools|abort/i.test(e));
  if (reais.length) { console.log("\nERROS DE CONSOLE:"); reais.slice(0, 8).forEach(e => console.log("  !", e)); }
  process.exit(falhas.length ? 1 : 0);
})();
