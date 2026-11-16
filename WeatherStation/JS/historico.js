

(function () {
  "use strict";
  const { $, valido, fmt, hora, cor } = Estacao.util;
  const { API, GRANDEZAS } = Estacao;

  // Só as grandezas numéricas (a luz é claro/escuro e não entra aqui)
  const opcoes = GRANDEZAS.filter((g) => !g.estado);

  /* Data de hoje no formato AAAA-MM-DD, no horário do navegador */
  function hojeTexto() {
    const d = new Date();
    const dois = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + dois(d.getMonth() + 1) + "-" + dois(d.getDate());
  }

  function mensagem(texto) { $("hd-msg").textContent = texto; }

  /* Pergunta à API e devolve o JSON (ou lança erro com texto amigável) */
  async function buscar(caminho) {
    let resposta;
    try { resposta = await fetch(API.base + caminho); }
    catch (e) { throw new Error("Não foi possível falar com a API em " + API.base + ". Ligue a API (python app.py) ou ajuste o endereço em JS/config.js."); }
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || "A API respondeu com erro " + resposta.status + ".");
    }
    return resposta.json();
  }

  async function carregar() {
    const dia = $("hd-dia").value;
    const g = opcoes.find((x) => x.chave === $("hd-grandeza").value);
    const janela = parseInt($("hd-media").value, 10);
    if (!dia) { mensagem("Escolha um dia."); return; }
    mensagem("Buscando no banco de dados...");
    try {
      const qs = `inicio=${dia}&fim=${dia}&ordem=asc&limite=5000&estacao=${encodeURIComponent(API.estacaoId)}` + (janela > 1 ? `&media_movel=${janela}` : "");
      const [lista, resumo] = await Promise.all([
        buscar("/api/leituras?" + qs),
        buscar(`/api/resumo?dia=${dia}&estacao=${encodeURIComponent(API.estacaoId)}`)
      ]);
      desenharResumo(resumo, g);
      desenharGrafico(lista.leituras, g, janela);
      mensagem(lista.quantidade ? lista.quantidade + " leituras encontradas em " + dia.split("-").reverse().join("/") + "." : "Nenhuma leitura gravada neste dia.");
    } catch (erro) {
      mensagem(erro.message);
      $("hd-resumo").innerHTML = "";
      Estacao.Graficos.desenhar($("hd-svg"), [], { cor: g.cor, grade: { x: 10, y: 8 }, pad: { l: 58, r: 10, t: 12, b: 24 } });
      $("hd-legenda").textContent = "";
    }
  }

  /* Cartõezinhos com o resumo do dia */
  function desenharResumo(r, g) {
    const s = r[g.chave] || {};
    const cartao = (rotulo, valor) => `<div class="mini-cartao"><span>${rotulo}</span><b class="num">${valor}</b></div>`;
    $("hd-resumo").innerHTML = [
      cartao("Leituras no dia", fmt(r.total_leituras, 0)),
      cartao(g.nome + " mínima", fmt(s.min, g.casas) + " " + g.unidade),
      cartao(g.nome + " máxima", fmt(s.max, g.casas) + " " + g.unidade),
      cartao(g.nome + " média", fmt(s.media, g.casas) + " " + g.unidade),
      Estacao.USA_PLUVIOMETRO ? cartao("Chuva no dia", fmt(r.chuva_total_dia_mm, 2) + " mm") : "",
      cartao("Alertas de gás", fmt(r.alertas_gas, 0))
    ].join("");
  }

  /* Gráfico do dia. Com média móvel, a linha é a média e os pontinhos claros são as leituras originais. */
  function desenharGrafico(leituras, g, janela) {
    const svg = $("hd-svg");
    const suave = janela > 1;
    const bruta = leituras.map((l) => ({ q: new Date(l.data_hora), v: valido(l[g.chave]) ? l[g.chave] : null }));
    const serie = suave ? leituras.map((l) => ({ q: new Date(l.data_hora), v: valido(l[g.chave + "_mm"]) ? l[g.chave + "_mm"] : null })) : bruta;
    const todos = bruta.concat(serie).map((p) => p.v).filter(valido);

    // Escala comum para a linha e para os pontos originais
    let faixa;
    if (g.barras) faixa = [0, Math.max(1, ...todos, 0)];
    else if (todos.length) {
      let mn = Math.min(...todos), mx = Math.max(...todos);
      if (mx - mn < (g.margemMin || 1)) { const m = (mx + mn) / 2; mn = m - (g.margemMin || 1) / 2; mx = m + (g.margemMin || 1) / 2; }
      const folga = (mx - mn) * 0.12;
      faixa = [mn - folga, mx + folga];
    }
    Estacao.Graficos.desenhar(svg, serie, {
      cor: g.cor, barras: g.barras, faixa, eixos: true, casasEixo: g.casas,
      grade: { x: 10, y: 8 }, pad: { l: 58, r: 10, t: 12, b: 24 },
      hover: { nome: g.nome + (suave ? " (média móvel)" : ""), unidade: g.unidade, casas: g.casas, dica: "hd-dica" }
    });

    // Pontos originais (claros) por cima do gráfico suavizado
    if (suave && svg.__geo) {
      const { xDe, yDe } = svg.__geo;
      bruta.forEach((p, i) => {
        if (!valido(p.v)) return;
        const c = Estacao.util.el("circle", { cx: xDe(i), cy: yDe(p.v), r: 2.2, fill: cor(g.cor), "fill-opacity": 0.35 }, svg);
        c.style.pointerEvents = "none";
      });
    }
    const vals = serie.map((p) => p.v).filter(valido);
    $("hd-legenda").textContent = !vals.length ? "Sem dados de " + g.nome.toLowerCase() + " neste dia."
      : g.nome + " em " + g.unidade + (suave ? ", média móvel de " + janela + " leituras (pontos claros: leituras originais). " : ". ")
        + "Primeira leitura às " + hora(serie[0].q) + ", última às " + hora(serie[serie.length - 1].q) + ".";
  }

  /* ---------- montagem ---------- */
  $("hd-grandeza").innerHTML = opcoes.map((g) => `<option value="${g.chave}">${g.nome}</option>`).join("");
  $("hd-dia").value = hojeTexto();
  $("hd-carregar").addEventListener("click", carregar);
  ["hd-dia", "hd-grandeza", "hd-media"].forEach((id) => $(id).addEventListener("change", carregar));
  window.addEventListener("resize", () => { clearTimeout(Estacao.__tHist); Estacao.__tHist = setTimeout(() => { if ($("hd-svg").__geo) carregar(); }, 250); });

  Estacao.Historico = { carregar };
  carregar();
})();
