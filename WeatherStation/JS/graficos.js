

(function () {
  "use strict";
  const { cor, valido, fmt, hora, el } = Estacao.util;

  /* Calcula [min, max] do eixo Y com uma folga de 12% em cima e embaixo.
     Se os valores variam muito pouco, garante uma variação mínima. */
  function escala(vals, margemMin) {
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < margemMin) {
      const meio = (max + min) / 2;
      min = meio - margemMin / 2;
      max = meio + margemMin / 2;
    }
    const folga = (max - min) * 0.12;
    return [min - folga, max + folga];
  }

  function desenhar(svg, pontos, opts) {
    // --- 1. Tamanho real do SVG na tela ---
    const caixa = svg.getBoundingClientRect();
    const W = Math.round(caixa.width), H = Math.round(caixa.height);
    if (W < 10 || H < 10) return;                       // elemento escondido: nada a fazer
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);       // 1 unidade do SVG = 1 pixel

    const pad = opts.pad || { l: 0, r: 0, t: 4, b: 4 };
    const larguraUtil = W - pad.l - pad.r;
    const alturaUtil = H - pad.t - pad.b;
    const corLinha = cor(opts.cor);

    while (svg.firstChild) svg.removeChild(svg.firstChild);   // limpa o desenho anterior

    // --- 2. Grade de fundo ---
    if (opts.grade) {
      for (let i = 0; i <= opts.grade.y; i++) {
        const y = pad.t + alturaUtil * i / opts.grade.y;
        el("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: "linha-grade" + (i % 2 === 0 ? " forte" : "") }, svg);
      }
      for (let i = 0; i <= opts.grade.x; i++) {
        const x = pad.l + larguraUtil * i / opts.grade.x;
        el("line", { x1: x, x2: x, y1: pad.t, y2: H - pad.b, class: "linha-grade" }, svg);
      }
    }

    const vals = pontos.map((p) => p.v).filter(valido);
    if (vals.length === 0) { svg.__geo = null; return; }   // sem dados: só a grade

    // --- 3. Escalas: valor -> posição na tela ---
    const [min, max] = opts.faixa || escala(vals, opts.margemMin || 1);
    const n = pontos.length;
    const xDe = (i) => pad.l + (n === 1 ? larguraUtil / 2 : larguraUtil * i / (n - 1));
    const yDe = (v) => pad.t + alturaUtil * (1 - (v - min) / (max - min || 1));

    // --- 4. Marcas: barras OU linha + área ---
    if (opts.barras) {
      const larg = Math.max(2, larguraUtil / Math.max(n, 1) * 0.6);
      pontos.forEach((p, i) => {
        if (!valido(p.v)) return;
        const y = yDe(Math.max(p.v, min));
        el("rect", { x: xDe(i) - larg / 2, y, width: larg, height: Math.max(0, H - pad.b - y), rx: Math.min(2, larg / 2), fill: corLinha, "fill-opacity": 0.75 }, svg);
      });
    } else {
      // Monta o caminho da linha. Leitura inválida "quebra" a linha (sem ligar buracos).
      let d = "", aberto = false, ultimoX = 0, ultimoY = 0, primeiroX = null;
      pontos.forEach((p, i) => {
        if (!valido(p.v)) { aberto = false; return; }
        const x = xDe(i), y = yDe(p.v);
        // Em degraus (grandezas de dois estados): anda na horizontal e só depois sobe/desce
        if (aberto && opts.degrau) d += "L" + x.toFixed(1) + " " + ultimoY.toFixed(1) + " ";
        d += (aberto ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " ";
        ultimoY = y;
        if (primeiroX === null) primeiroX = x;
        ultimoX = x; aberto = true;
      });

      // Área sob a linha com degradê (cor forte em cima, transparente embaixo)
      const idGrad = "grad-" + (svg.id || Math.random().toString(36).slice(2));
      const defs = el("defs", {}, svg);
      const grad = el("linearGradient", { id: idGrad, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      el("stop", { offset: "0%", "stop-color": corLinha, "stop-opacity": 0.14 }, grad);
      el("stop", { offset: "100%", "stop-color": corLinha, "stop-opacity": 0 }, grad);
      if (vals.length > 1) {
        el("path", { d: d + `L${ultimoX.toFixed(1)} ${H - pad.b} L${primeiroX.toFixed(1)} ${H - pad.b} Z`, fill: `url(#${idGrad})` }, svg);
      }
      el("path", { d, class: "traco", stroke: corLinha }, svg);

      // Com uma única leitura não há linha para ver: desenha um ponto
      if (vals.length === 1) {
        const i = pontos.findIndex((p) => valido(p.v));
        el("circle", { cx: xDe(i), cy: yDe(pontos[i].v), r: 4, fill: corLinha }, svg);
      }
    }

    // --- 5. Rótulos dos eixos ---
    if (opts.eixos && opts.grade) {
      // Eixo Y: um número a cada duas linhas da grade
      for (let i = 0; i <= opts.grade.y; i += 2) {
        const v = max - (max - min) * i / opts.grade.y;
        const y = pad.t + alturaUtil * i / opts.grade.y;
        el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end", class: "rotulo-eixo" }, svg).textContent = opts.formatarY ? opts.formatarY(v) : fmt(v, opts.casasEixo ?? 1);
      }
      // Eixo X: até 5 horários distribuídos
      const marcas = Math.min(5, n);
      for (let k = 0; k < marcas; k++) {
        const i = marcas === 1 ? n - 1 : Math.round((n - 1) * k / (marcas - 1));
        const ancora = k === 0 ? "start" : (k === marcas - 1 ? "end" : "middle");
        el("text", { x: xDe(i), y: H - 4, "text-anchor": ancora, class: "rotulo-eixo" }, svg).textContent = hora(pontos[i].q).slice(0, 5);
      }
    }

    // --- 6. Interação: caixinha ao passar o mouse ---
    // Guardamos a geometria no próprio <svg> para o evento de mouse usar depois.
    svg.__geo = { W, H, pad, n, xDe, yDe, pontos, corLinha, hover: opts.hover };
    svg.__camadaHover = el("g", { "pointer-events": "none" }, svg);
    if (opts.hover && !svg.__hoverLigado) ligarHover(svg);
  }

  /* Liga os eventos de mouse/toque (uma única vez por SVG) */
  function ligarHover(svg) {
    svg.__hoverLigado = true;
    const dica = document.getElementById(svg.__geo.hover.dica);

    function mover(ev) {
      const g = svg.__geo;
      if (!g) return;
      const caixa = svg.getBoundingClientRect();
      const x = ev.clientX - caixa.left;

      // Descobre qual leitura está mais perto do mouse
      let i = Math.round((x - g.pad.l) / (g.W - g.pad.l - g.pad.r) * (g.n - 1));
      i = Math.max(0, Math.min(g.n - 1, i));
      const p = g.pontos[i];
      limpar();
      if (!p || !valido(p.v)) return;

      // Linha vertical + bolinha sobre o ponto
      const cx = g.xDe(i), cy = g.yDe(p.v);
      el("line", { x1: cx, x2: cx, y1: g.pad.t, y2: g.H - g.pad.b, class: "mira" }, svg.__camadaHover);
      el("circle", { cx, cy, r: 5, fill: g.corLinha, class: "ponto-mira" }, svg.__camadaHover);

      // Caixinha de texto, posicionada em relação ao cartão do gráfico
      const h = g.hover;
      const pai = dica.offsetParent.getBoundingClientRect();
      const textoValor = h.formatar ? h.formatar(p.v) : fmt(p.v, h.casas) + " " + h.unidade;
      dica.innerHTML = `${textoValor}<span>${h.nome} às ${hora(p.q)}</span>`;
      dica.style.left = (caixa.left - pai.left + cx) + "px";
      dica.style.top = (caixa.top - pai.top + cy) + "px";
      dica.hidden = false;
    }

    function limpar() {
      if (svg.__camadaHover) while (svg.__camadaHover.firstChild) svg.__camadaHover.removeChild(svg.__camadaHover.firstChild);
    }
    function sair() { limpar(); dica.hidden = true; }

    svg.addEventListener("pointermove", mover);
    svg.addEventListener("pointerdown", mover);
    svg.addEventListener("pointerleave", sair);
  }

  Estacao.Graficos = { desenhar };
})();
