# ============================================================================
#  mq135.py - SENSOR DE QUALIDADE DO AR (MQ-135): da tensão até o CO2 em ppm
# ----------------------------------------------------------------------------
#  O MQ-135 muda a própria resistência (Rs) conforme a concentração de gás.
#  Passos: lê a tensão -> calcula Rs -> corrige por temperatura e umidade ->
#  compara com R0 (a resistência do sensor em ar limpo) -> converte em ppm.
# ============================================================================
import time
from machine import Pin, ADC


class MQ135:
    def __init__(self, pino_analogico, pino_digital, cfg):
        self.cfg = cfg                              # as configurações do config.py
        self.adc = ADC(Pin(pino_analogico))         # transforma o pino em entrada analógica
        # atenuação de 11 dB: mede de 0 a cerca de 3,3 V
        self.adc.atten(ADC.ATTN_11DB)
        self.saida_digital = Pin(pino_digital, Pin.IN)   # DOUT: alerta de gás do próprio módulo

    def volts(self):
        soma = 0
        # faz 16 leituras e tira a média (reduz ruído)
        for _ in range(16):
            try:
                # leitura em microvolts (calibrada) -> volts
                soma += self.adc.read_uv() / 1_000_000
            except AttributeError:                       # firmware antigo, sem read_uv()
                # leitura bruta 0..4095 -> volts (menos precisa)
                soma += self.adc.read() / 4095 * 3.3
            time.sleep_ms(5)                             # pequena pausa entre leituras
        v_adc = soma / 16                                # média: tensão no pino do ESP32
        if self.cfg.USA_DIVISOR_MQ:
            # O divisor de tensão reduziu o sinal (5 V viram 3,33 V). Aqui "desfazemos"
            # a redução para obter a tensão real do sensor.
            return v_adc * (self.cfg.R_DIV_ALTO + self.cfg.R_DIV_BAIXO) / self.cfg.R_DIV_BAIXO
        # sem divisor: o valor lido já é o do sensor
        return v_adc

    def resistencia(self):
        v_out = self.volts()
        # tensão impossível: sensor sem fio ou desligado
        if v_out < 0.05 or v_out >= self.cfg.VC:
            return None
        return self.cfg.RL_KOHM * (self.cfg.VC - v_out) / v_out   # Rs em kΩ

    @staticmethod
    def fator_correcao(t, h):
        # A resistência muda com a temperatura (t) e a umidade (h): compensamos com o DHT22.
        if t < 20:
            return 0.00035 * t * t - 0.02718 * t + 1.39538 - (h - 33.0) * 0.0018
        return -0.003333333 * t - 0.001923077 * h + 1.130128205

    def ppm_co2(self, rs, t, h):
        # tira o efeito de temperatura e umidade
        rs_corrigido = rs / self.fator_correcao(t, h)
        # Curva do sensor: converte a razão Rs/R0 em ppm
        return self.cfg.PARA * (rs_corrigido / self.cfg.MQ_R0) ** (-self.cfg.PARB)

    def alerta_gas(self):
        # Saída digital: o módulo avisa sozinho quando o gás passa do limite do potenciômetro.
        return self.saida_digital.value() == self.cfg.MQ_DO_ALERTA

    def calibrar_r0(self):
        """Rode UMA vez, ao ar livre e limpo, depois do pré-aquecimento (2 a 3 min).
        Copie o número devolvido para MQ_R0 no config.py."""
        rs = self.resistencia()
        # R0 que dá ~415 ppm no ar limpo
        return rs * (self.cfg.ATM_CO2 / self.cfg.PARA) ** (1.0 / self.cfg.PARB)

