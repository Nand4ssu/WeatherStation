
import json
import math
import time

import paho.mqtt.client as mqtt

import config

cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="simulador-esp32")
cliente.connect(config.MQTT_BROKER, config.MQTT_PORTA, 60)
cliente.loop_start()
time.sleep(1)

for i in range(10):
    leitura = {
        "temperatura": round(24 + 2 * math.sin(i / 2), 1),
        "umidade": round(62 - 4 * math.sin(i / 2), 1),
        "pressao_hpa": round(925 + i * 0.1, 1),
        "pressao_nm_hpa": round(1012 + i * 0.1, 1),
        "luminosidade": "claro" if i < 6 else "escuro",
        "co2_ppm": 500 + i * 20,
        "gas_alerta": False,
    }
    cliente.publish(config.MQTT_TOPICO, json.dumps(leitura))
    print(f"enviada {i + 1}/10:", leitura)
    time.sleep(2)

cliente.loop_stop()
cliente.disconnect()
print("Pronto. Abra http://127.0.0.1:5000/api/leituras?limite=5")
