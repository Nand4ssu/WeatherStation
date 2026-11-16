

(function () {
  "use strict";
  const { $, el, fmt } = Estacao.util;
  const TAM = 256;                       // lado de um ladrilho, em pixels
  const RAD = Math.PI / 180;

  let zoom = 16;                         // 3 = continente ... 18 = rua
  let estacoes = [];                     // [{id, nome, latitude, longitude}]

  /* ---------- as fórmulas ---------- */

  /* (latitude, longitude, zoom) -> posição (x, y) em pixels no mapa-mundo */
  function projetar(lat, lon, z) {
    const mundo = TAM * Math.pow(2, z);                   // lado do mundo em pixels
    const x = (lon + 180) / 360 * mundo;
    const latRad = lat * RAD;
    const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * mundo;
    return { x, y };
  }

  /* A conta inversa: posição (x, y) em pixels -> (latitude, longitude) */
  function inverter(x, y, z) {
    const mundo = TAM * Math.pow(2, z);
    const lon = x / mundo * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / mundo))) / RAD;
    return { lat, lon };
  }

  /* Quantos metros cada pixel representa naquela latitude e zoom */
  function metrosPorPixel(lat, z) {
    return 156543.03392 * Math.cos(lat * RAD) / Math.pow(2, z);
  }

  /* Distância em metros entre dois pontos da Terra (fórmula de Haversine) */
  function distanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371008.8;
    const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------- desenho ---------- */
  function desenhar() {
    const area = $("mapa-area");
    if (!area || !estacoes.length) return;
    const principal = estacoes[0];
    const L = area.clientWidth, A = area.clientHeight;
    if (L < 10) return;

    const centro = projetar(principal.latitude, principal.longitude, zoom);
    const origemX = centro.x - L / 2, origemY = centro.y - A / 2;

    area.innerHTML = "";

    // 1) Ladrilhos do OpenStreetMap (precisam de internet; sem ela, fica só a grade)
    const camada = document.createElement("div");
    camada.className = "mapa-ladrilhos";
    const n = Math.pow(2, zoom);
    for (let ty = Math.floor(origemY / TAM); ty <= Math.floor((origemY + A) / TAM); ty++) {
      for (let tx = Math.floor(origemX / TAM); tx <= Math.floor((origemX + L) / TAM); tx++) {
        if (ty < 0 || ty >= n) continue;
        const img = document.createElement("img");
        img.alt = "";
        img.width = TAM; img.height = TAM;
        img.style.left = Math.round(tx * TAM - origemX) + "px";
        img.style.top = Math.round(ty * TAM - origemY) + "px";
        img.src = `https://tile.openstreetmap.org/${zoom}/${((tx % n) + n) % n}/${ty}.png`;
        img.onerror = () => img.remove();           // sem internet: some o ladrilho, a grade continua
        camada.appendChild(img);
      }
    }
    area.appendChild(camada);

    // 2) Grade de coordenadas (linhas a cada 100 px, com os valores reais de latitude e longitude)
    const svg = el("svg", { class: "mapa-grade", width: L, height: A, viewBox: `0 0 ${L} ${A}`, "aria-hidden": "true" });
    for (let px = 50; px < L; px += 100) {
      el("line", { x1: px, x2: px, y1: 0, y2: A, class: "mapa-linha" }, svg);
      const { lon } = inverter(origemX + px, origemY, zoom);
      if (px < L - 70) el("text", { x: px + 4, y: 13, class: "mapa-rotulo" }, svg).textContent = fmt(lon, 4) + "°";   // longitudes no topo (o rodapé fica livre para a régua e o crédito)
    }
    for (let py = 40; py < A; py += 100) {
      el("line", { x1: 0, x2: L, y1: py, y2: py, class: "mapa-linha" }, svg);
      const { lat } = inverter(origemX, origemY + py, zoom);
      el("text", { x: 4, y: py - 4, class: "mapa-rotulo" }, svg).textContent = fmt(lat, 4) + "°";
    }
    // 3) Marcadores: a estação principal no centro e as outras, se estiverem na tela
    estacoes.forEach((e, i) => {
      const p = projetar(e.latitude, e.longitude, zoom);
      const x = p.x - origemX, y = p.y - origemY;
      if (x < -20 || y < -20 || x > L + 20 || y > A + 20) return;
      const g = el("g", { class: "mapa-pino" + (i === 0 ? "" : " secundario"), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, svg);
      el("circle", { r: 20, class: "mapa-halo" }, g);
      el("path", { d: "M0 0 C-9 -12 -12 -18 -12 -23 A12 12 0 1 1 12 -23 C12 -18 9 -12 0 0 Z", class: "mapa-gota" }, g);
      el("circle", { cy: -23, r: 4.5, class: "mapa-furo" }, g);
      el("text", { y: 16, "text-anchor": "middle", class: "mapa-nome" }, g).textContent = e.nome;
    });
    // 4) Régua de escala (100 pixels valem quantos metros?)
    const mpp = metrosPorPixel(principal.latitude, zoom);
    let metros = 100 * mpp;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];
    const escolha = nice.filter((v) => v <= metros * 1.5).pop() || nice[0];
    const larguraRegua = escolha / mpp;
    el("line", { x1: L - 12 - larguraRegua, x2: L - 12, y1: A - 16, y2: A - 16, class: "mapa-regua" }, svg);
    el("text", { x: L - 12 - larguraRegua / 2, y: A - 22, "text-anchor": "middle", class: "mapa-rotulo forte" }, svg)
      .textContent = escolha >= 1000 ? (escolha / 1000) + " km" : escolha + " m";
    area.appendChild(svg);

    // 5) Texto de atribuição exigido pelo OpenStreetMap
    const cred = document.createElement("span");
    cred.className = "mapa-credito";
    cred.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    area.appendChild(cred);

    preencherPainel(principal, centro, mpp);
  }

  /* Painel ao lado: mostra os números por trás do mapa */
  function preencherPainel(e, centro, mpp) {
    const n = Math.pow(2, zoom);
    const tx = Math.floor(centro.x / TAM), ty = Math.floor(centro.y / TAM);
    const dados = [
      ["Estação", e.nome],
      ["Latitude (φ)", fmt(e.latitude, 5) + "°"],
      ["Longitude (λ)", fmt(e.longitude, 5) + "°"],
      ["Zoom (z)", zoom + "  (mundo de " + (TAM * n).toLocaleString("pt-BR") + " px)"],
      ["Posição no plano (x, y)", fmt(centro.x, 1) + " px,  " + fmt(centro.y, 1) + " px"],
      ["Ladrilho (x/y)", tx + " / " + ty],
      ["Escala", fmt(mpp, 3) + " m por pixel"]
    ];
    if (estacoes.length > 1) {
      const o = estacoes[1];
      dados.push(["Distância até " + o.nome, fmt(distanciaMetros(e.latitude, e.longitude, o.latitude, o.longitude) / 1000, 2) + " km (Haversine)"]);
    }
    $("mapa-dados").innerHTML = dados.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join("");
  }

  /* ---------- início: coordenadas da API (se houver) ou do config.js ---------- */
  function iniciar() {
    estacoes = [{ id: Estacao.API.estacaoId, nome: Estacao.ESTACAO.nome, latitude: Estacao.ESTACAO.latitude, longitude: Estacao.ESTACAO.longitude }];
    desenhar();
    fetch(Estacao.API.base + "/api/estacoes")
      .then((r) => r.ok ? r.json() : [])
      .then((lista) => {
        const validas = lista.filter((e) => typeof e.latitude === "number" && typeof e.longitude === "number");
        if (!validas.length) return;
        // a estação configurada vem primeiro
        validas.sort((a, b) => (a.id === Estacao.API.estacaoId ? -1 : 0) - (b.id === Estacao.API.estacaoId ? -1 : 0));
        estacoes = validas;
        desenhar();
      })
      .catch(() => { /* API desligada: segue com as coordenadas do config.js */ });
  }

  $("mapa-mais").addEventListener("click", () => { zoom = Math.min(18, zoom + 1); desenhar(); });
  $("mapa-menos").addEventListener("click", () => { zoom = Math.max(3, zoom - 1); desenhar(); });
  let temporizador;
  window.addEventListener("resize", () => { clearTimeout(temporizador); temporizador = setTimeout(desenhar, 150); });

  Estacao.Mapa = { projetar, inverter, metrosPorPixel, distanciaMetros, desenhar, iniciar };
  iniciar();
})();
