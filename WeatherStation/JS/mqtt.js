

(function () {
  "use strict";

  class ClienteMQTT {
    /**
     * @param {string}   url            endereço wss://... do broker
     * @param {string}   topico         tópico a assinar
     * @param {function} aoReceber      (topico, texto) chamada a cada mensagem
     * @param {function} aoMudarEstado  (estado, mensagem) estado = conectando|conectado|desconectado
     */
    constructor(url, topico, aoReceber, aoMudarEstado) {
      this.url = url;
      this.topico = topico;
      this.clientId = "dashboard-" + Math.random().toString(16).slice(2, 10); // identificador único
      this.aoReceber = aoReceber;
      this.aoMudarEstado = aoMudarEstado;
      this.buffer = new Uint8Array(0);  // bytes recebidos ainda não processados
      this.encerrado = false;           // true quando o usuário pediu para desconectar
      this.tentativa = 0;               // contador para o "tempo de espera" da reconexão
      this.ws = null;
      this.ping = null;
      this.reconexao = null;
    }

    /* ----- Montagem de pacotes (formato binário do MQTT) ----- */

    /* Texto -> [tamanho (2 bytes), ...bytes UTF-8] */
    static texto(s) {
      const b = new TextEncoder().encode(s);
      return [b.length >> 8, b.length & 255, ...b];
    }

    /* Tamanho restante do pacote, codificado em 1 a 4 bytes (7 bits cada) */
    static tamanho(n) {
      const out = [];
      do {
        let byte = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) byte |= 128;   // bit 7 = "tem mais bytes"
        out.push(byte);
      } while (n > 0);
      return out;
    }

    /* Pacote completo = cabeçalho + tamanho + corpo */
    pacote(cabecalho, corpo) {
      return new Uint8Array([cabecalho, ...ClienteMQTT.tamanho(corpo.length), ...corpo]);
    }

    /* ----- Conexão ----- */

    conectar() {
      this.encerrado = false;
      this.aoMudarEstado("conectando");

      try {
        this.ws = new WebSocket(this.url, ["mqtt"]);
      } catch (e) {
        this.aoMudarEstado("desconectado", "Endereço do broker inválido.");
        return;
      }
      this.ws.binaryType = "arraybuffer";

      // WebSocket aberto -> envia o pacote CONNECT do MQTT
      this.ws.onopen = () => {
        const corpo = [
          ...ClienteMQTT.texto("MQTT"), // nome do protocolo
          4,                            // versão 3.1.1
          0x02,                         // flags: sessão limpa
          0, 30,                        // keep-alive: 30 s
          ...ClienteMQTT.texto(this.clientId)
        ];
        this.ws.send(this.pacote(0x10, corpo));
      };

      this.ws.onmessage = (ev) => this.receber(new Uint8Array(ev.data));

      // Conexão caiu -> tenta de novo, esperando cada vez mais (2, 4, 8... até 30 s)
      this.ws.onclose = () => {
        clearInterval(this.ping);
        if (this.encerrado) { this.aoMudarEstado("desconectado", "Desconectado do broker."); return; }
        this.tentativa++;
        const espera = Math.min(30, 2 ** this.tentativa);
        this.aoMudarEstado("desconectado", "Sem conexão com o broker. Nova tentativa em " + espera + " s.");
        this.reconexao = setTimeout(() => this.conectar(), espera * 1000);
      };
    }

    /* ----- Recebimento ----- */

    /* Os bytes podem chegar "quebrados" ou "colados". Juntamos tudo num
       buffer e extraímos um pacote de cada vez enquanto houver completos. */
    receber(dados) {
      const junto = new Uint8Array(this.buffer.length + dados.length);
      junto.set(this.buffer);
      junto.set(dados, this.buffer.length);
      this.buffer = junto;

      while (this.buffer.length >= 2) {
        // Lê o "tamanho restante" (1 a 4 bytes)
        let mult = 1, tam = 0, i = 1, byte;
        do {
          if (i >= this.buffer.length) return;       // ainda faltam bytes
          byte = this.buffer[i++];
          tam += (byte & 127) * mult;
          mult *= 128;
        } while (byte & 128);

        if (this.buffer.length < i + tam) return;    // pacote incompleto: espera mais
        this.tratar(this.buffer.slice(0, i + tam), i);
        this.buffer = this.buffer.slice(i + tam);
      }
    }

    /* Decide o que fazer conforme o tipo do pacote */
    tratar(p, inicio) {
      const tipo = p[0] >> 4;

      if (tipo === 2) {                       // CONNACK: broker respondeu ao CONNECT
        if (p[inicio + 1] !== 0) {
          this.aoMudarEstado("desconectado", "O broker recusou a conexão (código " + p[inicio + 1] + ").");
          this.encerrar();
          return;
        }
        this.tentativa = 0;
        // Conectou: assina o tópico (SUBSCRIBE, QoS 0)
        const corpo = [0, 1, ...ClienteMQTT.texto(this.topico), 0];
        this.ws.send(this.pacote(0x82, corpo));
        // Ping a cada 25 s para o broker não derrubar a conexão por inatividade
        this.ping = setInterval(() => {
          if (this.ws.readyState === 1) this.ws.send(new Uint8Array([0xC0, 0]));
        }, 25000);

      } else if (tipo === 9) {                // SUBACK: assinatura confirmada
        this.aoMudarEstado("conectado");

      } else if (tipo === 3) {                // PUBLISH: chegou uma mensagem
        const qos = (p[0] >> 1) & 3;
        let i = inicio;
        const tamTopico = (p[i] << 8) | p[i + 1];
        const topico = new TextDecoder().decode(p.slice(i + 2, i + 2 + tamTopico));
        i += 2 + tamTopico;
        if (qos > 0) i += 2;                  // QoS 1/2 trazem um identificador extra
        this.aoReceber(topico, new TextDecoder().decode(p.slice(i)));
      }
    }

    /* Desconecta de propósito (não tenta reconectar) */
    encerrar() {
      this.encerrado = true;
      clearTimeout(this.reconexao);
      clearInterval(this.ping);
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(new Uint8Array([0xE0, 0])); } catch (e) { /* DISCONNECT */ }
      }
      if (this.ws) this.ws.close();
    }
  }

  Estacao.ClienteMQTT = ClienteMQTT;
})();
