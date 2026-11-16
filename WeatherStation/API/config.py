
import os

# --- MQTT: de onde vêm as leituras do ESP32 ---
MQTT_BROKER = os.getenv("MQTT_BROKER", "broker.hivemq.com")   # mesmo broker do ESP32
MQTT_PORTA = int(os.getenv("MQTT_PORTA", "1883"))             # porta comum (sem WebSocket)
MQTT_TOPICO = os.getenv("MQTT_TOPICO", "estacao/unip-si2p13/dados")   # IGUAL ao do ESP32 e do site

# --- Banco de dados (SQLite: um arquivo só, sem instalar servidor) ---
BANCO = os.getenv("BANCO", "estacao.db")

# --- A estação que está enviando os dados ---
ESTACAO_ID = os.getenv("ESTACAO_ID", "techgirls-01")          # identificador curto, sem espaços
ESTACAO_NOME = os.getenv("ESTACAO_NOME", "TechGirls Weather Station")
# Coordenadas do local (para o mapa/geolocalização do TCC). Deixe vazio se ainda não sabe.
ESTACAO_LATITUDE = os.getenv("ESTACAO_LATITUDE") or None
ESTACAO_LONGITUDE = os.getenv("ESTACAO_LONGITUDE") or None

# --- Fuso horário usado para separar os dias (Brasília = -3) ---
FUSO_HORAS = int(os.getenv("FUSO_HORAS", "-3"))

# --- Servidor web da API ---
API_HOST = os.getenv("API_HOST", "0.0.0.0")      # 0.0.0.0 = aceita conexões de outros aparelhos da rede
API_PORTA = int(os.getenv("API_PORTA", "5000"))


# --- Site (dashboard) servido pela própria API ---
# Quando a API está dentro da pasta do projeto, ela também entrega o site em http://127.0.0.1:5000.
# Assim, um único comando (python app.py) liga tudo. A API procura o index.html na pasta de cima
# (ou em ../dashboard). Para apontar outra pasta, defina PASTA_SITE.
def _achar_site():
    aqui = os.path.dirname(os.path.abspath(__file__))
    for candidata in (os.getenv("PASTA_SITE"), os.path.join(aqui, ".."), os.path.join(aqui, "..", "dashboard")):
        if candidata and os.path.isfile(os.path.join(candidata, "index.html")):
            return os.path.abspath(candidata)
    return None                      # sem site por perto: a API funciona só como API

PASTA_SITE = _achar_site()
