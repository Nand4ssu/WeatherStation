/* ==========================================================
   demo.js - DADOS SIMULADOS (modo demonstração)
   ----------------------------------------------------------
   Gera leituras falsas, porém realistas, para apresentar o site
   sem o ESP32 ligado. O formato é o mesmo do JSON real.
   ========================================================== */

(function () {
  "use strict";

  // Estado atual da simulação: cada leitura varia um pouco a partir da anterior
  const sim = { t: 24.5, h: 62, p: 1013.2, co2: 520, claro: true, chuvaTotal: 0 };

  /* Sorteia uma variação entre -amplitude/2 e +amplitude/2 */
  const variacao = (amplitude) => (Math.random() - 0.5) * amplitude;

  /* Gera UMA leitura no mesmo formato enviado pelo ESP32 */
  Estacao.leituraSimulada = function () {
    sim.t += variacao(0.4);
    sim.h = Math.min(95, Math.max(30, sim.h + variacao(1.2)));      // umidade entre 30 e 95 %
    sim.p += variacao(0.3);
    sim.co2 = Math.min(1500, Math.max(410, sim.co2 + variacao(40))); // CO₂ entre 410 e 1500 ppm

    // Luz: o módulo LDR só diz claro/escuro. Na demonstração, muda de vez em quando.
    if (Math.random() < 0.08) sim.claro = !sim.claro;

    // Chuva (só se o pluviômetro estiver ligado no config.js): de vez em quando "bascula" 1 a 4 vezes
    const basculadas = Math.random() < 0.25 ? 1 + Math.floor(Math.random() * 4) : 0;
    const mm = +(basculadas * 0.2789).toFixed(2);
    sim.chuvaTotal += mm;
    const mmPorHora = +(mm * 3600 / (Estacao.CONFIG.intervaloDemoMs / 1000)).toFixed(2);

    const leitura = {
      temperatura: +sim.t.toFixed(1),
      umidade: +sim.h.toFixed(1),
      pressao_hpa: +(sim.p - 0.2).toFixed(1),
      pressao_nm_hpa: +sim.p.toFixed(1),
      luminosidade: sim.claro ? "claro" : "escuro",
      co2_ppm: Math.round(sim.co2),
      gas_alerta: sim.co2 > 1200      // o módulo avisa quando o gás passa do limite
    };
    if (Estacao.USA_PLUVIOMETRO) {
      leitura.chuva_mm = mm;
      leitura.chuva_mm_h = mmPorHora;
      leitura.chuva_total_mm = +sim.chuvaTotal.toFixed(2);
    }
    return leitura;
  };
})();
