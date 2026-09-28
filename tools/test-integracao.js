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
      falharApos: null        // a partir da n-ésima chamada, falha
    };
    window.fetch = async (url, opts) => {
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
      if (status !== 200) return { ok: false, status,
        json: async () => API.corpo || { error: { message: 'This API key is not scoped to a workspace' } } };
      const t = typeof API.texto === 'function' ? API.texto(body.messages[0].content) : API.texto;
      return { ok: true, status: 200, json: async () => ({ content: [{ text: t }] }) };
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
    await campo('api-key-input', 'sk-ant-api03-de-mentira-integra');
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
    exigir(!h["anthropic-workspace-id"], "mandou workspace sem o campo preenchido");
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
               vezes: (el.textContent.match(/console\\.anthropic\\.com/g) || []).length,
               linhas: el.querySelectorAll('.pz-table tbody tr').length };
    })()`);
    exigir(r.avisos === 1, `a mesma falha virou ${r.avisos} avisos em vez de um só`);
    exigir(r.vezes === 1, `a mensagem se repetiu ${r.vezes} vezes`);

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
    await campo('api-key-input', 'sk-ant-api03-de-mentira-guardada');
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
    exigir(msg.includes('Workspace'), "a mensagem mudou: " + msg);
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

  ws.close(); chrome.kill();
  console.log(`cenários: ${ok.length} passaram, ${falhas.length} falharam`);
  ok.forEach(x => console.log("  ✓", x));
  if (falhas.length) { console.log("\nFALHAS:"); falhas.forEach(x => console.log("  ✗", x)); }
  const reais = errosConsole.filter(e => !/favicon|DevTools|abort/i.test(e));
  if (reais.length) { console.log("\nERROS DE CONSOLE:"); reais.slice(0, 8).forEach(e => console.log("  !", e)); }
  process.exit(falhas.length ? 1 : 0);
})();
