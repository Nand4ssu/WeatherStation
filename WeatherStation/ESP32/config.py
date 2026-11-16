# ============================================================================
#  config.py - AJUSTES DO PROGRAMA (não tem senha aqui)
# ----------------------------------------------------------------------------
#  Tudo que você pode querer mudar fica neste arquivo. Os outros arquivos
#  (main.py, pressao.py, chuva.py, mq135.py, rede.py) só leem estes valores.
# ============================================================================

SIMULADOR = False       # True = rodando no Wokwi | False = placa ESP32 de verdade

if SIMULADOR:
    WIFI_SSID = "Wokwi-GUEST"       # rede Wi-Fi de teste do próprio simulador
    WIFI_SENHA = ""                 # essa rede não tem senha
    USA_DIVISOR_MQ = False          # no desenho do Wokwi o AOUT liga direto, sem divisor
    INTERVALO_S = 10                # no simulador, envia a cada 10 segundos
    PREAQUECIMENTO_S = 20           # e não precisa esperar 2 minutos
else:
    # Nome e senha do Wi-Fi vêm do arquivo segredos.py (veja o modelo que acompanha o projeto)
    try:
        from segredos import WIFI_SSID, WIFI_SENHA
    except ImportError:             # o arquivo não está na placa: avisa e segue
        WIFI_SSID, WIFI_SENHA = "SEU_WIFI", "SUA_SENHA"
        print("ATENCAO: falta o arquivo segredos.py na placa (nome e senha do Wi-Fi)")
    USA_DIVISOR_MQ = True           # na placa real, o AOUT passa pelo divisor 10k/20k
    INTERVALO_S = 10                # TESTE: envia a cada 10 s. Depois do teste, troque para 60
    PREAQUECIMENTO_S = 120          # o aquecedor do MQ-135 precisa de 1 a 3 minutos

# --- MQTT ---
MQTT_BROKER = "broker.hivemq.com"                  # servidor MQTT (público e gratuito)
MQTT_TOPICO = b"estacao/unip-si2p13/dados"         # o MESMO tópico que o site e a API escutam
                                                   # (o b antes das aspas significa "bytes")
ALTITUDE_M = 0          # altitude do local, em metros (para a pressão ao nível do mar)

# --- Pinos do ESP32 (conforme o protótipo) ---
PIN_DHT = 15            # DATA do DHT22
PIN_SDA, PIN_SCL = 21, 22   # fios do barramento I2C (BMP280)
PIN_LDR_DO = 32         # saída digital do módulo LDR
PIN_MQ_AO = 34          # saída analógica (AOUT) do MQ-135
PIN_MQ_DO = 23          # saída digital (DOUT) do MQ-135
PIN_CHUVA = 13          # fio do pluviômetro (sensor reed)

# --- Pluviômetro de báscula (OPCIONAL) ---
# Deixe False se você não tem o pluviômetro ligado. Com False, o programa não prepara o pino 13
# e não envia os campos de chuva. Mude para True quando o pluviômetro (sensor reed) estiver ligado,
# e salve também o arquivo chuva.py na placa.
USA_PLUVIOMETRO = False
K_MM_PULSO = 0.2789     # milímetros de chuva por basculada (calibração volumétrica do projeto)
# ignora pulsos com menos de 100 ms entre si (trepidação do contato reed)
DEBOUNCE_MS = 100

# --- Módulo LDR (saída digital DO) ---
# Em muitos módulos, DO = 1 quer dizer ESCURO e DO = 0 quer dizer CLARO.
# Se no seu módulo acontecer o contrário, troque este valor para 0.
LDR_DO_ESCURO = 1

# --- MQ-135 (sensor de qualidade do ar) ---
# Em muitos módulos, DOUT = 0 quer dizer "gás acima do limite". Se for o contrário, troque para
# 1.
MQ_DO_ALERTA = 0
RL_KOHM = 10.0                         # resistor de carga do módulo, em kΩ
VC = 5.0                               # tensão que alimenta o sensor (5 V)
R_DIV_ALTO, R_DIV_BAIXO = 10.0, 20.0   # divisor de tensão 10 kΩ / 20 kΩ (usado na placa real)
# R0 em kΩ: valor de partida! Troque pelo de calibrar_r0()
MQ_R0 = 76.63
# constantes da curva do CO2: ppm = PARA * (Rs/R0) ** -PARB
PARA, PARB = 116.6020682, 2.769034857
ATM_CO2 = 415.0                        # CO2 do ar limpo, em ppm (usado na calibração)

