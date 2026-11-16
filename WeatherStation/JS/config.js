
window.Estacao = window.Estacao || {};

Estacao.params = new URLSearchParams(location.search);


Estacao.CONFIG = {
  // Endereço do broker MQTT (WebSocket seguro). Precisa ser o MESMO usado no ESP32.
  broker: Estacao.params.get("broker") || "wss://broker.hivemq.com:8884/mqtt",

  // Tópico onde o ESP32 publica o JSON. Use um nome único do seu grupo!
  // (Troque aqui E no MQTT_TOPICO do código do ESP32, sempre os dois iguais.)
  topico: Estacao.params.get("topico") || "estacao/unip-si2p13/dados",

  // Quantas leituras guardar na memória (as mais antigas são descartadas)
  maxPontos: 120,

  // Se ficar conectado sem receber nada por este tempo, mostra um aviso (3 min)
  semDadosAposMs: 3 * 60 * 1000,

  // De quantos em quantos ms a demonstração gera uma leitura nova
  intervaloDemoMs: 3000
};


Estacao.GRANDEZAS = [
  { chave: "temperatura",    nome: "Temperatura",      sub: "DHT22",                        unidade: "°C",  casas: 1, cor: "--c-temperatura", margemMin: 1 },
  { chave: "umidade",        nome: "Umidade relativa", sub: "DHT22",                        unidade: "%",   casas: 1, cor: "--c-umidade",     margemMin: 2 },
  { chave: "pressao_nm_hpa", nome: "Pressão",          sub: "BMP280, nível do mar",         unidade: "hPa", casas: 1, cor: "--c-pressao",     margemMin: 2 },
  // O módulo LDR só informa claro ou escuro. O app converte o texto em 1 (claro) ou 0 (escuro).
  { chave: "luz_nivel",      nome: "Luminosidade",     sub: "Módulo LDR, claro ou escuro",  unidade: "",    casas: 0, cor: "--c-luz",         estado: true, rotulos: { 1: "Claro", 0: "Escuro" } },
  { chave: "co2_ppm",        nome: "Qualidade do ar",  sub: "MQ-135, CO₂ estimado",         unidade: "ppm", casas: 0, cor: "--c-ar",          margemMin: 20 }
];


/* Campos numéricos do JSON que a página guarda a cada leitura.
   Além deles, o app trata "luminosidade" (texto) e "gas_alerta" (verdadeiro/falso). */
Estacao.CAMPOS = ["temperatura", "umidade", "pressao_hpa", "pressao_nm_hpa", "co2_ppm", "chuva_mm", "chuva_mm_h", "chuva_total_mm"];

/* Limites de CO₂ (ppm) para o selo de qualidade do ar */
Estacao.LIMITES_AR = { boa: 800, moderada: 1200 }; // acima de 1200 = ruim

Estacao.ESTACAO = {
  nome: "TechGirls Weather Station",
  latitude: -23.5505,      // graus; negativo = Sul
  longitude: -46.6333      // graus; negativo = Oeste
};

/* ----------------------------------------------------------
   API (histórico gravado no banco de dados)
   Endereço onde a API em Python (pasta EstacaoAPI) está rodando.
   No seu computador: http://127.0.0.1:5000
   Depois de publicada na internet, troque pelo endereço dela.
   Também dá para testar pela URL: index.html?api=http://127.0.0.1:5000
   ---------------------------------------------------------- */
Estacao.API = {
  // 1) ?api=... na URL; 2) se o site foi aberto pela própria API (porta 5000), o mesmo endereço;
  // 3) caso contrário, a API local. Quando a API for publicada na internet, troque o último valor.
  base: (Estacao.params.get("api") || (/^https?:$/.test(location.protocol) && location.port === "5000" ? location.origin : "http://127.0.0.1:5000")).replace(/\/+$/, ""),
  estacaoId: "techgirls-01"        // o mesmo ESTACAO_ID do config.py da API
};

/* ----------------------------------------------------------
   ALERTAS DE CONDIÇÕES EXTREMAS
   Cada regra olha a leitura mais recente. Mude os limites à vontade.
   nivel "alerta" = vermelho no site; "atencao" = amarelo.
   ---------------------------------------------------------- */
Estacao.ALERTAS = {
  calorIntenso: 35,        // °C, a partir de
  frioIntenso: 5,          // °C, até
  arMuitoSeco: 30,         // % de umidade, até
  umidadeMuitoAlta: 90,    // % de umidade, a partir de
  chuvaForte: 10,          // mm/h, a partir de
  pressaoBaixa: 995,       // hPa (nível do mar), até: sinal de tempestade
  quedaBruscaPressao: 1.5  // hPa perdidos nas últimas 4 leituras
};
