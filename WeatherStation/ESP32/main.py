# ============================================================================
#  main.py - ESTAÇÃO METEOROLÓGICA COM ESP32 + MICROPYTHON (programa principal)
# ----------------------------------------------------------------------------
#  Sensores:  DHT22 (temperatura e umidade)    BMP280 (pressão, por I2C)
#             Módulo LDR (claro ou escuro)     MQ-135 (qualidade do ar)
#             Pluviômetro de báscula (OPCIONAL: chuva, por interrupção; veja config.py)
#  Envio:     Wi-Fi + MQTT, em formato JSON, a cada INTERVALO_S segundos
#
#  O programa é dividido em módulos (arquivos), cada um com uma função:
#     config.py    ajustes (pinos, tópico, constantes)      segredos.py  Wi-Fi
#     pressao.py   drivers BMP280 / BMP180                  chuva.py     pluviômetro
#     mq135.py     qualidade do ar                          rede.py      Wi-Fi + MQTT
#     main.py      este arquivo: lê tudo e envia
#  chuva.py só é usado se USA_PLUVIOMETRO = True no config.py.
#
#  Na placa real, salve TODOS estes arquivos dentro do ESP32. O main.py roda
#  sozinho sempre que a placa ligar.
# ============================================================================
import time
import dht
from machine import Pin, I2C

import config as cfg
from pressao import criar_sensor_pressao, pressao_nivel_mar
from mq135 import MQ135
from rede import enviar


# ============================================================================
# 1. PREPARAÇÃO DO HARDWARE: cria um "objeto" para cada sensor
# ============================================================================
sensor_dht = dht.DHT22(Pin(cfg.PIN_DHT))     # DHT22 no pino 15

# I2C(0, ...) usa o 1º barramento I2C do ESP32. freq=100000 = 100 kHz (velocidade segura).
i2c = I2C(0, sda=Pin(cfg.PIN_SDA), scl=Pin(cfg.PIN_SCL), freq=100000)
pressao = criar_sensor_pressao(i2c)          # se der erro aqui, confira os fios SDA/SCL
print("Sensor de pressao:", pressao.nome)

ldr_do = Pin(cfg.PIN_LDR_DO, Pin.IN)         # módulo LDR: entrada digital (0 ou 1)
mq = MQ135(cfg.PIN_MQ_AO, cfg.PIN_MQ_DO, cfg)
chuva = None
if cfg.USA_PLUVIOMETRO:                      # só prepara o pluviômetro se ele estiver ligado
    from chuva import Pluviometro
    chuva = Pluviometro(cfg.PIN_CHUVA, cfg.K_MM_PULSO, cfg.DEBOUNCE_MS)


def calibrar_r0():
    """Digite calibrar_r0() no Shell (ar livre e limpo, depois de 3 min ligado)
    e copie o número para MQ_R0 no config.py."""
    return mq.calibrar_r0()


# ============================================================================
# 2. LEITURA DE TODOS OS SENSORES
# ============================================================================
def ler_sensores(janela_s, aquecido):
    dados = {}                              # dicionário: guarda "nome": valor de cada leitura

    # --- DHT22: temperatura e umidade (aceita no máximo 1 leitura a cada 2 s) ---
    try:
        sensor_dht.measure()                                       # pede uma medição
        dados["temperatura"] = round(sensor_dht.temperature(), 1)  # °C, com 1 casa decimal
        dados["umidade"] = round(sensor_dht.humidity(), 1)         # %, com 1 casa decimal
    except OSError:                                                # sensor não respondeu
        dados["temperatura"] = dados["umidade"] = None             # None vira null no JSON

    # --- BMP280: pressão ---
    try:
        # devolve temperatura e pressão
        t_bmp, p = pressao.ler()
        dados["pressao_hpa"] = round(p, 1)                         # pressão no local
        # ao nível do mar
        dados["pressao_nm_hpa"] = round(pressao_nivel_mar(p, cfg.ALTITUDE_M), 1)
    except OSError:
        dados["pressao_hpa"] = dados["pressao_nm_hpa"] = None

    # --- Módulo LDR: só diz se está claro ou escuro (saída digital) ---
    dados["luminosidade"] = "escuro" if ldr_do.value() == cfg.LDR_DO_ESCURO else "claro"

    # --- MQ-135: CO2 estimado (só depois do pré-aquecimento e com o DHT22 funcionando) ---
    dados["co2_ppm"] = None
    if aquecido and dados["temperatura"] is not None:
        rs = mq.resistencia()
        if rs:                                                     # rs válido (não é None)
            dados["co2_ppm"] = round(mq.ppm_co2(rs, dados["temperatura"], dados["umidade"]))
    # True = alerta de gás do módulo
    dados["gas_alerta"] = mq.alerta_gas()

    # --- Pluviômetro (opcional): chuva do intervalo, intensidade e acumulado ---
    if chuva is not None:
        mm, mm_h, total = chuva.ler(janela_s)
        dados["chuva_mm"] = round(mm, 2)
        dados["chuva_mm_h"] = round(mm_h, 2)
        dados["chuva_total_mm"] = round(total, 2)
    return dados


# ============================================================================
# 3. PROGRAMA PRINCIPAL
#    Usamos um laço contínuo (sem Deep Sleep) porque o MQ-135 precisa ficar
#    aquecido e o pluviômetro precisa contar pulsos o tempo todo.
# ============================================================================
def main():
    modo = "SIMULADOR (Wokwi)" if cfg.SIMULADOR else "PLACA REAL"
    print("Modo:", modo, "| topico:", cfg.MQTT_TOPICO.decode())
    print("Envio a cada", cfg.INTERVALO_S, "segundos")
    inicio = time.ticks_ms()                       # instante em que o programa começou
    ultimo = inicio                                # instante do último envio
    while True:                                    # repete para sempre
        time.sleep(cfg.INTERVALO_S)                # espera o intervalo entre as leituras
        agora = time.ticks_ms()
        janela_s = time.ticks_diff(agora, ultimo) / 1000    # segundos desde o último envio
        ultimo = agora
        # O MQ-135 só vale depois do pré-aquecimento:
        aquecido = time.ticks_diff(agora, inicio) > cfg.PREAQUECIMENTO_S * 1000
        dados = ler_sensores(janela_s, aquecido)   # lê todos os sensores
        print(dados)                               # mostra no Shell do Thonny
        enviar(dados)                              # manda para o site e para a API pelo MQTT


# Só inicia o programa quando este arquivo é executado diretamente (F5 ou ao ligar a placa).
if __name__ == "__main__":
    main()

