

(function () {
  "use strict";
  const { $, valido, fmt } = Estacao.util;
  const A = Estacao.ALERTAS;

  /* Devolve [{nivel, texto}], onde nivel é "alerta" (forte) ou "atencao" (moderado).
     "leitura" é a mais recente; "historico" é a lista de todas (para ver a tendência). */
  function avaliar(u, historico) {
    const lista = [];
    const alerta = (texto) => lista.push({ nivel: "alerta", texto });
    const atencao = (texto) => lista.push({ nivel: "atencao", texto });

    if (valido(u.temperatura)) {
      if (u.temperatura >= A.calorIntenso) alerta("Calor intenso: " + fmt(u.temperatura, 1) + " °C");
      else if (u.temperatura <= A.frioIntenso) alerta("Frio intenso: " + fmt(u.temperatura, 1) + " °C");
    }
    if (valido(u.umidade)) {
      if (u.umidade <= A.arMuitoSeco) atencao("Ar muito seco: " + fmt(u.umidade, 0) + " % de umidade");
      else if (u.umidade >= A.umidadeMuitoAlta) atencao("Umidade muito alta: " + fmt(u.umidade, 0) + " %");
    }
    if (valido(u.chuva_mm_h) && u.chuva_mm_h >= A.chuvaForte) alerta("Chuva forte: " + fmt(u.chuva_mm_h, 1) + " mm/h");
    else if (valido(u.chuva_mm_h) && u.chuva_mm_h > 0) atencao("Chuva em andamento: " + fmt(u.chuva_mm_h, 1) + " mm/h");

    const p = u.pressao_nm_hpa;
    if (valido(p) && p <= A.pressaoBaixa) atencao("Pressão muito baixa: " + fmt(p, 1) + " hPa (risco de tempestade)");
    // Queda brusca: compara com a leitura de 3 posições atrás
    const vals = historico.map((l) => l.pressao_nm_hpa).filter(valido);
    if (vals.length >= 4 && vals[vals.length - 4] - vals[vals.length - 1] >= A.quedaBruscaPressao) {
      atencao("Queda brusca de pressão: " + fmt(vals[vals.length - 4] - vals[vals.length - 1], 1) + " hPa nas últimas leituras");
    }

    if (valido(u.co2_ppm) && u.co2_ppm > Estacao.LIMITES_AR.moderada) alerta("Qualidade do ar ruim: " + fmt(u.co2_ppm, 0) + " ppm de CO₂");
    if (u.gas_alerta) alerta("Alerta de gás detectado pelo módulo MQ-135");
    return lista;
  }

  /* Desenha os alertas dentro de <ul id="alertas"> */
  function atualizar(u, historico) {
    const ul = $("alertas");
    if (!ul) return;
    const lista = avaliar(u, historico);
    ul.innerHTML = lista.length
      ? lista.map((a) => `<li class="alerta ${a.nivel}"><span class="alerta-icone" aria-hidden="true">!</span>${a.texto}</li>`).join("")
      : `<li class="alerta ok"><span class="alerta-icone" aria-hidden="true">✓</span>Nenhuma condição extrema no momento.</li>`;
  }

  Estacao.Alertas = { avaliar, atualizar };
})();
