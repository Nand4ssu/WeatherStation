

(function () {
  "use strict";
  const { $, valido, fmt, hora, cor } = Estacao.util;
  const { CONFIG, GRANDEZAS, CAMPOS, LIMITES_AR } = Estacao;

  /* ---------- Estado da página ---------- */
  const historico = [];        // lista de leituras, da mais antiga para a mais nova
  let ultimaChegada = 0;       // quando chegou a última leitura (ms)
  let abaAtual = "temperatura";// grandeza mostrada no gráfico grande
  let cliente = null;          // conexão MQTT ativa (ou null)
  let demo = null;             // temporizador da demonstração (ou null)
  const pilula = $("pilula");


  /* ==========================================================
     1. CONEXÃO
     ========================================================== */

  /* Atualiza a "pílula" do topo e a mensagem do formulário */
  function definirEstado(estado, msg) {
    const textos = { conectado: "Conectado", conectando: "Conectando", desconectado: "Desconectado", demo: "Demonstração" };
    pilula.dataset.estado = estado;          // o CSS muda a cor conforme este valor
    pilula.textContent = textos[estado];
    if (msg !== undefined) $("mensagem").textContent = msg;
    else if (estado === "conectado") $("mensagem").textContent = "Conectado. Aguardando leituras do tópico " + CONFIG.topico + ".";
    else if (estado === "conectando") $("mensagem").textContent = "Conectando ao broker...";
  }

  /* Abre a conexão com o broker usando CONFIG.broker e CONFIG.topico */
  function conectar() {
    pararDemo();
    if (cliente) cliente.encerrar();
    cliente = new Estacao.ClienteMQTT(CONFIG.broker, CONFIG.topico, aoReceberMensagem, definirEstado);
    cliente.conectar();
  }

  /* Chamada a cada mensagem MQTT. O texto deve ser um JSON do ESP32. */
  function aoReceberMensagem(topico, texto) {
    let dados;
    try { dados = JSON.parse(texto); }
    catch (e) { $("mensagem").textContent = "Mensagem ignorada: o conteúdo recebido não é um JSON."; return; }
    registrar(dados);
  }

  /* Modo demonstração: leituras simuladas a cada poucos segundos */
  function iniciarDemo() {
    if (cliente) { cliente.encerrar(); cliente = null; }
    pararDemo();
    definirEstado("demo", "Mostrando dados simulados a cada " + (CONFIG.intervaloDemoMs / 1000) + " segundos. Clique em Conectar para voltar ao ESP32.");
    registrar(Estacao.leituraSimulada());
    demo = setInterval(() => registrar(Estacao.leituraSimulada()), CONFIG.intervaloDemoMs);
  }
  function pararDemo() { if (demo) { clearInterval(demo); demo = null; } }


  /* ==========================================================
     2. REGISTRO DAS LEITURAS
     ========================================================== */

  /* Guarda uma leitura no histórico e redesenha a tela */
  function registrar(dados) {
    const leitura = { quando: new Date() };
    // Copia só os campos conhecidos; qualquer valor que não seja número vira null
    for (const k of CAMPOS) leitura[k] = valido(dados[k]) ? dados[k] : null;

    // Luminosidade: o ESP32 manda o texto "claro" ou "escuro". Guardamos 1 ou 0
    // para poder desenhar o gráfico em degraus.
    const luz = typeof dados.luminosidade === "string" ? dados.luminosidade.toLowerCase() : null;
    leitura.luz_nivel = luz === "claro" ? 1 : (luz === "escuro" ? 0 : null);

    // Alerta de gás do módulo MQ-135: verdadeiro, falso ou desconhecido (null)
    leitura.gas_alerta = typeof dados.gas_alerta === "boolean" ? dados.gas_alerta : null;

    historico.push(leitura);
    if (historico.length > CONFIG.maxPontos) historico.shift();   // descarta a mais antiga
    ultimaChegada = Date.now();
    renderizar();
  }

  /* Série de uma grandeza: [{q: horário, v: valor}, ...] */
  function serie(chave) { return historico.map((l) => ({ q: l.quando, v: l[chave] })); }

  /* Classifica o CO₂: devolve [classe CSS, texto] ou null se não houver valor */
  function qualidadeAr(ppm) {
    if (!valido(ppm)) return null;
    if (ppm <= LIMITES_AR.boa) return ["boa", "Boa"];
    if (ppm <= LIMITES_AR.moderada) return ["moderada", "Moderada"];
    return ["ruim", "Ruim"];
  }

  /* Compara a pressão atual com a de 3 leituras atrás (variação > 0,5 hPa) */
  function tendenciaPressao() {
    const vals = historico.map((l) => l.pressao_nm_hpa).filter(valido);
    if (vals.length < 4) return null;
    const dif = vals[vals.length - 1] - vals[vals.length - 4];
    if (dif > 0.5) return "subindo";
    if (dif < -0.5) return "caindo";
    return "estável";
  }


  /* ==========================================================
     3. DESENHO DA TELA
     ========================================================== */

  /* Atualiza TODA a tela com base no histórico */
  function renderizar() {
    const u = historico[historico.length - 1];   // leitura mais recente
    if (!u) return;

    // Destaque do topo
    $("v-temp").textContent = fmt(u.temperatura, 1);
    $("v-umid").textContent = fmt(u.umidade, 0);
    $("v-press").textContent = fmt(u.pressao_nm_hpa ?? u.pressao_hpa, 1);
    $("ultima").textContent = "Última leitura às " + hora(u.quando);

    // Frase-resumo: "Ambiente claro, qualidade do ar boa, pressão caindo."
    const partes = [];
    if (u.luz_nivel !== null) partes.push(u.luz_nivel === 1 ? "ambiente claro" : "ambiente escuro");
    const q = qualidadeAr(u.co2_ppm);
    partes.push(q ? "qualidade do ar " + q[1].toLowerCase() : "qualidade do ar aguardando o aquecimento do MQ-135");
    if (u.gas_alerta) partes.push("alerta de gás ativo");
    const tend = tendenciaPressao();
    if (tend) partes.push("pressão " + tend);
    const frase = partes.join(", ");
    $("resumo").textContent = frase.charAt(0).toUpperCase() + frase.slice(1) + ".";

    $("tendencia").textContent = tend
      ? "Pressão ao nível do mar, " + tend + " em relação às leituras anteriores"
      : "Pressão ao nível do mar, leitura a leitura";

    // Alertas de condições extremas (alertas.js)
    if (Estacao.Alertas) Estacao.Alertas.atualizar(u, historico);

    desenharGraficos();
    desenharBoletim();
    desenharTabela();
  }

  /* Redesenha só os gráficos (também usado quando a janela muda de tamanho) */
  function desenharGraficos() {
    desenharBarografo();
    desenharMiniGraficos();
    desenharHistorico();
  }

  /* Gráfico de pressão do topo */
  function desenharBarografo() {
    Estacao.Graficos.desenhar($("svg-barografo"), serie("pressao_nm_hpa"), {
      cor: "--c-pressao", margemMin: 2, casasEixo: 1,
      grade: { x: 12, y: 8 }, pad: { l: 4, r: 4, t: 8, b: 8 }
    });
  }

  /* Cria os cartões do boletim (só na primeira vez) e preenche os valores */
  function desenharBoletim() {
    const box = $("boletim");
    if (!box.dataset.montado) {
      box.innerHTML = GRANDEZAS.map((g) => `
        <article class="cartao" id="i-${g.chave}" style="--cor-sensor: var(${g.cor})">
          <div class="nome">${g.nome}<span>${g.sub}</span></div>
          <div class="valor num"><span data-v>--</span><small>${g.unidade}</small><span data-selo></span></div>
          <svg id="mini-${g.chave}" aria-hidden="true"></svg>
          <div class="faixa num" data-faixa>Sem dados</div>
        </article>`).join("");
      box.dataset.montado = "1";
    }

    const u = historico[historico.length - 1];
    for (const g of GRANDEZAS) {
      const cartao = $("i-" + g.chave);
      const vals = serie(g.chave).map((p) => p.v).filter(valido);
      const atual = vals.length ? serie(g.chave).slice(-1)[0].v : null;

      // Valor grande: número, ou o texto do estado (Claro / Escuro)
      cartao.querySelector("[data-v]").textContent = g.estado
        ? (atual === null ? "--" : g.rotulos[atual])
        : fmt(atual, g.casas);

      // Selos do cartão de qualidade do ar: classificação do CO₂ e alerta de gás
      const selo = cartao.querySelector("[data-selo]");
      selo.innerHTML = "";
      if (g.chave === "co2_ppm") {
        const q = qualidadeAr(atual);
        if (q) selo.innerHTML += `<span class="selo ${q[0]}">${q[1]}</span>`;
        if (u && u.gas_alerta) selo.innerHTML += `<span class="selo ruim">Alerta de gás</span>`;
      }

      // Linha de baixo: mín/máx; para claro/escuro, a hora da última mudança
      const faixa = cartao.querySelector("[data-faixa]");
      if (g.estado) {
        const mudanca = ultimaMudanca(g.chave);
        faixa.textContent = mudanca ? "Desde " + hora(mudanca) : "Sem dados";
      } else {
        faixa.textContent = vals.length ? "Mín. " + fmt(Math.min(...vals), g.casas) + "   Máx. " + fmt(Math.max(...vals), g.casas) : "Sem dados";
      }
    }
    desenharMiniGraficos();
  }

  /* Horário em que o valor atual de uma grandeza de dois estados começou
     (ou seja, quando mudou pela última vez). Devolve null se não há dados. */
  function ultimaMudanca(chave) {
    const s = serie(chave).filter((p) => valido(p.v));
    if (!s.length) return null;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].v === s[i].v) i--;
    return s[i].q;
  }

  /* Opções de desenho comuns a cada grandeza (mini-gráfico e histórico) */
  function opcoesGrafico(g, vals) {
    const op = { cor: g.cor, barras: g.barras, margemMin: g.margemMin };
    if (g.barras) op.faixa = [0, Math.max(1, ...vals)];   // barras sempre partem do zero
    if (g.estado) { op.degrau = true; op.faixa = [0, 1]; } // claro/escuro: degraus entre 0 e 1
    return op;
  }

  /* Mini-gráficos dentro de cada cartão */
  function desenharMiniGraficos() {
    for (const g of GRANDEZAS) {
      const svg = $("mini-" + g.chave);
      if (!svg) continue;
      const s = serie(g.chave);
      const vals = s.map((p) => p.v).filter(valido);
      Estacao.Graficos.desenhar(svg, s, { ...opcoesGrafico(g, vals), pad: { l: 0, r: 0, t: 5, b: 5 } });
    }
  }

  /* Cria os botões (abas) do histórico */
  function montarAbas() {
    const abas = $("abas");
    abas.innerHTML = GRANDEZAS.map((g) =>
      `<button type="button" role="tab" id="aba-${g.chave}" aria-selected="${g.chave === abaAtual}" data-chave="${g.chave}">${g.nome}</button>`).join("");
    abas.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-chave]");
      if (!b) return;
      abaAtual = b.dataset.chave;
      abas.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b));
      $("dica").hidden = true;
      desenharHistorico();
    });
  }

  /* Gráfico grande do histórico, para a aba selecionada */
  function desenharHistorico() {
    const g = GRANDEZAS.find((x) => x.chave === abaAtual);
    const s = serie(g.chave);
    const vals = s.map((p) => p.v).filter(valido);

    const rotuloEstado = (v) => g.rotulos[v >= 0.5 ? 1 : 0];   // só usado em grandezas de dois estados

    Estacao.Graficos.desenhar($("svg-historico"), s, {
      ...opcoesGrafico(g, vals),
      eixos: true, casasEixo: g.casas,
      // Claro/escuro só precisa de duas linhas no eixo (topo e base)
      grade: { x: 10, y: g.estado ? 2 : 8 }, pad: { l: 58, r: 10, t: 12, b: 24 },
      formatarY: g.estado ? rotuloEstado : undefined,
      hover: { nome: g.nome, unidade: g.unidade, casas: g.casas, dica: "dica", formatar: g.estado ? rotuloEstado : undefined }
    });

    if (!vals.length) $("legenda").textContent = "Sem dados de " + g.nome.toLowerCase() + " ainda.";
    else if (g.estado) $("legenda").textContent = g.nome + ", " + vals.length + " leituras. Está " + g.rotulos[vals[vals.length - 1]].toLowerCase() + " desde " + hora(ultimaMudanca(g.chave)) + ".";
    else $("legenda").textContent = g.nome + " em " + g.unidade + ", " + vals.length + " leituras. Mínimo " + fmt(Math.min(...vals), g.casas) + ", máximo " + fmt(Math.max(...vals), g.casas) + ".";
  }

  /* Tabela com as 10 leituras mais recentes (a mais nova no topo) */
  function desenharTabela() {
    const linhas = historico.slice(-10).reverse();
    $("tabela-vazia").hidden = linhas.length > 0;
    $("tabela").innerHTML = linhas.map((l) => `<tr>
      <td>${hora(l.quando)}</td><td>${fmt(l.temperatura, 1)}</td><td>${fmt(l.umidade, 1)}</td>
      <td>${fmt(l.pressao_nm_hpa ?? l.pressao_hpa, 1)}</td>
      <td>${l.luz_nivel === null ? "--" : (l.luz_nivel === 1 ? "Claro" : "Escuro")}</td>
      <td>${fmt(l.co2_ppm, 0)}</td>
      <td>${l.gas_alerta === null ? "--" : (l.gas_alerta ? "Alerta" : "Normal")}</td>
      ${Estacao.USA_PLUVIOMETRO ? `<td>${fmt(l.chuva_mm_h, 2)}</td>` : ""}</tr>`).join("");
  }


  /* ==========================================================
     4. EVENTOS E INÍCIO
     ========================================================== */

  /* A cada 30 s, avisa se está conectado mas o ESP32 parou de enviar */
  setInterval(() => {
    if (pilula.dataset.estado === "conectado" && ultimaChegada && Date.now() - ultimaChegada > CONFIG.semDadosAposMs) {
      $("mensagem").textContent = "Conectado ao broker, mas sem leituras há mais de 3 minutos. Verifique se o ESP32 está ligado e no Wi-Fi.";
    }
  }, 30000);

  /* Formulário: preenche com os valores atuais e conecta ao enviar */
  $("campo-broker").value = CONFIG.broker;
  $("campo-topico").value = CONFIG.topico;
  $("form-conexao").addEventListener("submit", (e) => {
    e.preventDefault();                                   // não recarregar a página
    CONFIG.broker = $("campo-broker").value.trim();
    CONFIG.topico = $("campo-topico").value.trim();
    if (!/^wss?:\/\//.test(CONFIG.broker)) { $("mensagem").textContent = "O endereço do broker precisa começar com wss:// (ou ws:// em rede local)."; return; }
    if (!CONFIG.topico) { $("mensagem").textContent = "Informe o tópico em que o ESP32 publica."; return; }
    conectar();
  });
  $("btn-desconectar").addEventListener("click", () => {
    pararDemo();
    if (cliente) { cliente.encerrar(); cliente = null; }
    definirEstado("desconectado", "Desconectado. Clique em Conectar para voltar a receber as leituras.");
  });
  $("btn-demo").addEventListener("click", iniciarDemo);

  /* Ao redimensionar a janela, redesenha os gráficos no novo tamanho */
  let temporizadorResize;
  window.addEventListener("resize", () => {
    clearTimeout(temporizadorResize);
    temporizadorResize = setTimeout(desenharGraficos, 150);
  });

  /* Ao trocar entre modo claro/escuro, redesenha para pegar as novas cores */
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", desenharGraficos);

  /* Sem pluviômetro: tira da página a coluna e o texto da chuva */
  if (!Estacao.USA_PLUVIOMETRO) {
    ["th-chuva", "sobre-chuva"].forEach((id) => { const e = $(id); if (e) e.remove(); });
  }

  /* Início: monta a interface vazia e conecta (ou abre a demonstração) */
  montarAbas();
  desenharBoletim();
  desenharGraficos();
  desenharTabela();
  if (Estacao.params.get("demo") === "1") iniciarDemo(); else conectar();

  // Atalho para testes no console do navegador: __estacao.registrar({...})
  window.__estacao = { registrar, historico };
})();
