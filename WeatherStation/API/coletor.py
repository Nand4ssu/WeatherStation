
import json
import random
import re
import paho.mqtt.client as mqtt

# id de estação aceito: letras, números, hífen e sublinhado (evita lixo vindo da internet)
PADRAO_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


class ColetorMQTT:
    def __init__(self, repositorio, broker, porta, topico, estacao_padrao):
        self.repo = repositorio
        self.broker, self.porta, self.topico = broker, porta, topico
        self.estacao_padrao = estacao_padrao
        self.conectado = False          # a API mostra isso em /api/saude
        self.recebidas = 0              # mensagens que chegaram
        self.gravadas = 0               # mensagens que viraram linha no banco
        self.cliente = None

    def iniciar(self):
        # ID do cliente diferente a cada execução, para o broker não confundir duas cópias da API
        self.cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                   client_id=f"estacao-api-{random.randint(0, 999999):06d}")
        self.cliente.on_connect = self._ao_conectar
        self.cliente.on_disconnect = self._ao_desconectar
        self.cliente.on_message = self._ao_receber
        self.cliente.reconnect_delay_set(min_delay=1, max_delay=30)    # tenta de novo em 1 a 30 s
        self.cliente.connect_async(self.broker, self.porta, keepalive=60)
        self.cliente.loop_start()       # roda em outra "linha de execução" (thread)
        print(f"[MQTT] conectando a {self.broker}:{self.porta}, tópico {self.topico}")

    def parar(self):
        if self.cliente:
            self.cliente.loop_stop()
            self.cliente.disconnect()

    # ---------- eventos ----------
    def _ao_conectar(self, cliente, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            print("[MQTT] o broker recusou a conexão:", reason_code)
            return
        self.conectado = True
        cliente.subscribe(self.topico)  # (re)assina a cada conexão
        print("[MQTT] conectado. Aguardando leituras...")

    def _ao_desconectar(self, cliente, userdata, flags, reason_code, properties):
        self.conectado = False
        print("[MQTT] desconectado. Tentando reconectar...")

    def _ao_receber(self, cliente, userdata, msg):
        self.recebidas += 1
        try:
            dados = json.loads(msg.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            print("[MQTT] mensagem ignorada: não é um JSON")
            return
        if not isinstance(dados, dict):
            print("[MQTT] mensagem ignorada: o JSON não é um objeto")
            return
        # Se o ESP32 mandar um campo "estacao", usamos; senão, vale a estação padrão do config.py
        estacao = dados.get("estacao")
        if not (isinstance(estacao, str) and PADRAO_ID.match(estacao)):
            estacao = self.estacao_padrao
        try:
            id_linha = self.repo.salvar(estacao, dados)
        except Exception as erro:       # um erro no banco nunca pode derrubar o coletor
            print("[BANCO] erro ao gravar:", erro)
            return
        if id_linha is None:
            print("[MQTT] mensagem ignorada: sem nenhum dado válido")
        else:
            self.gravadas += 1
            print(f"[BANCO] leitura {id_linha} gravada ({estacao})")
