# ============================================================================
#  rede.py - WI-FI E ENVIO POR MQTT
# ----------------------------------------------------------------------------
#  MQTT é um protocolo leve de mensagens: o ESP32 "publica" um JSON num
#  tópico do broker, e quem "assina" o tópico (a API e o site) recebe.
# ============================================================================
import json
import time
import network
import machine
import ubinascii
from umqtt.simple import MQTTClient

import config as cfg


def conectar_wifi():
    # STA_IF = a placa age como "cliente" de uma rede Wi-Fi
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)                       # liga o rádio Wi-Fi
    if not wlan.isconnected():              # se ainda não estiver conectada...
        print("Conectando ao Wi-Fi:", cfg.WIFI_SSID)
        wlan.connect(cfg.WIFI_SSID, cfg.WIFI_SENHA)   # ...pede para conectar
        for _ in range(30):                 # espera até 30 segundos
            if wlan.isconnected():
                break
            time.sleep(1)
        if wlan.isconnected():
            print("Wi-Fi conectado. IP:", wlan.ifconfig()[0])
    return wlan.isconnected()               # True se conectou, False se não


def enviar(dados):
    if not conectar_wifi():
        print("Sem Wi-Fi. Confira o nome e a senha em segredos.py (rede de 2,4 GHz)")
        return False
    try:
        # O ID do cliente precisa ser único: usamos o número de série da placa, em hexadecimal.
        cliente = MQTTClient(ubinascii.hexlify(machine.unique_id()), cfg.MQTT_BROKER)
        cliente.connect()                                      # conecta ao broker
        # json.dumps vira texto JSON; publish envia
        cliente.publish(cfg.MQTT_TOPICO, json.dumps(dados))
        cliente.disconnect()                                   # encerra a conexão
        print("Publicado no topico:", cfg.MQTT_TOPICO.decode())
        return True
    # erro de rede: mostra e segue em frente
    except OSError as e:
        print("Falha no MQTT:", e)
        return False

