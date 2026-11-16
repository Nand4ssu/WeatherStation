# ============================================================================
#  pressao.py - DRIVERS DOS SENSORES DE PRESSÃO (ligados por I2C)
# ----------------------------------------------------------------------------
#  "Driver" é a parte do código que sabe conversar com um sensor específico.
#  O sensor devolve números "crus" que precisam ser corrigidos por contas
#  (compensação) usando coeficientes gravados dentro dele.
#  O BMP280 é o sensor do projeto. O BMP180 é o parecido que aparece no
#  simulador Wokwi. A função criar_sensor_pressao() reconhece qual dos dois
#  está ligado, então o mesmo programa serve para os dois.
# ============================================================================
import time
from ustruct import unpack


class BMP280:
    # "class" cria um modelo (molde) de objeto
    nome = "BMP280"

    def __init__(self, i2c, addr=0x76):
        # __init__ roda quando criamos o sensor; addr = endereço I2C
        self.i2c = i2c                           # guarda o barramento I2C dentro do objeto
        self.addr = addr                         # guarda o endereço do sensor
        # Registrador 0xD0 guarda o "ID do chip". 0x58 = BMP280 (0x60 = BME280, parecido).
        if i2c.readfrom_mem(addr, 0xD0, 1)[0] not in (0x58, 0x60):
            raise OSError("BMP280 nao encontrado no endereco 0x%02X" % addr)
        # Lê 24 bytes a partir do registrador 0x88: coeficientes de calibração de fábrica.
        c = i2c.readfrom_mem(addr, 0x88, 24)
        # unpack transforma os 24 bytes em 12 números. "<" = ordem dos bytes do sensor,
        # "H" = inteiro sem sinal de 16 bits, "h" = inteiro com sinal de 16 bits.
        (self.T1, self.T2, self.T3,              # coeficientes da temperatura
         self.P1, self.P2, self.P3, self.P4, self.P5,
         self.P6, self.P7, self.P8, self.P9      # coeficientes da pressão
         ) = unpack("<HhhHhhhhhhhh", c)
        # Registrador 0xF5 (config): 0x08 liga um filtro que suaviza ruído nas leituras.
        i2c.writeto_mem(addr, 0xF5, bytes([0x08]))

    def _compensar(self, adc_t, adc_p):
        # Converte os valores crus (adc_t e adc_p) em temperatura e pressão reais.
        # São as fórmulas oficiais do datasheet da Bosch (fabricante do sensor).
        v1 = (adc_t / 16384.0 - self.T1 / 1024.0) * self.T2
        v2 = (adc_t / 131072.0 - self.T1 / 8192.0) ** 2 * self.T3
        t_fine = v1 + v2                          # valor intermediário, usado também na pressão
        temp = t_fine / 5120.0                    # temperatura em graus Celsius

        v1 = t_fine / 2.0 - 64000.0
        v2 = v1 * v1 * self.P6 / 32768.0
        v2 = v2 + v1 * self.P5 * 2.0
        v2 = v2 / 4.0 + self.P4 * 65536.0
        v1 = (self.P3 * v1 * v1 / 524288.0 + self.P2 * v1) / 524288.0
        v1 = (1.0 + v1 / 32768.0) * self.P1
        if v1 == 0:                               # evita divisão por zero
            return temp, 0.0
        p = 1048576.0 - adc_p
        p = (p - v2 / 4096.0) * 6250.0 / v1
        v1 = self.P9 * p * p / 2147483648.0
        v2 = p * self.P8 / 32768.0
        p = p + (v1 + v2 + self.P7) / 16.0        # pressão em Pascal
        return temp, p

    def ler(self):
        # "Forced Mode": o sensor fica dormindo e só mede quando mandamos.
        # Isso evita que ele esquente sozinho e distorça a medida.
        # 0xF4 (ctrl_meas): 0x55 = temperatura x2, pressão x16, modo forçado (1 medida).
        self.i2c.writeto_mem(self.addr, 0xF4, bytes([0x55]))
        for _ in range(20):                       # espera a medida terminar (até 200 ms)
            time.sleep_ms(10)                     # pausa de 10 milissegundos
            # Registrador 0xF3 (status): o bit 3 vale 1 enquanto o sensor está medindo.
            if not self.i2c.readfrom_mem(self.addr, 0xF3, 1)[0] & 0x08:
                break                             # terminou: sai da espera
        d = self.i2c.readfrom_mem(self.addr, 0xF7, 6)   # lê os 6 bytes do resultado
        # junta 3 bytes: pressão crua (20 bits)
        adc_p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
        adc_t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)  # junta 3 bytes: temperatura crua
        temp, pa = self._compensar(adc_t, adc_p)          # aplica as fórmulas de correção
        return temp, pa / 100.0                   # devolve (°C, hPa): 1 hPa = 100 Pa


class BMP180:
    nome = "BMP180"

    def __init__(self, i2c, addr=0x77):
        self.i2c = i2c
        self.addr = addr
        # No BMP180 o "ID do chip" (registrador 0xD0) vale 0x55.
        if i2c.readfrom_mem(addr, 0xD0, 1)[0] != 0x55:
            raise OSError("BMP180 nao encontrado no endereco 0x%02X" % addr)
        # 22 bytes a partir de 0xAA: 11 coeficientes de calibração (">" = bytes em ordem
        # inversa).
        c = i2c.readfrom_mem(addr, 0xAA, 22)
        (self.AC1, self.AC2, self.AC3, self.AC4, self.AC5, self.AC6,
         self.B1, self.B2, self.MB, self.MC, self.MD) = unpack(">hhhHHHhhhhh", c)
        # modo de alta resolução (leitura um pouco mais lenta)
        self.oss = 3

    @staticmethod
    def _div(a, b):
        # Divisão inteira que arredonda em direção ao zero, igual à linguagem C do datasheet.
        q = abs(a) // abs(b)
        return q if (a >= 0) == (b >= 0) else -q

    def _compensar(self, ut, up):
        # Fórmulas oficiais do datasheet da Bosch para o BMP180.
        # ">>" desloca os bits para a direita: é uma divisão rápida por 2, 4, 8, 16...
        # (>> 15 divide por 32768, por exemplo).
        x1 = ((ut - self.AC6) * self.AC5) >> 15
        x2 = self._div(self.MC << 11, x1 + self.MD)
        b5 = x1 + x2
        # temperatura em °C (a conta dá décimos de grau)
        temp = ((b5 + 8) >> 4) / 10.0
        b6 = b5 - 4000
        x1 = (self.B2 * ((b6 * b6) >> 12)) >> 11
        x2 = (self.AC2 * b6) >> 11
        x3 = x1 + x2
        b3 = (((self.AC1 * 4 + x3) << self.oss) + 2) >> 2
        x1 = (self.AC3 * b6) >> 13
        x2 = (self.B1 * ((b6 * b6) >> 12)) >> 16
        x3 = ((x1 + x2) + 2) >> 2
        b4 = (self.AC4 * (x3 + 32768)) >> 15
        b7 = (up - b3) * (50000 >> self.oss)
        p = (b7 * 2) // b4 if b7 < 0x80000000 else (b7 // b4) * 2
        x1 = (p >> 8) * (p >> 8)
        x1 = (x1 * 3038) >> 16
        x2 = (-7357 * p) >> 16
        p = p + ((x1 + x2 + 3791) >> 4)           # pressão em Pascal
        return temp, p

    def ler(self):
        # Comando 0x2E no registrador 0xF4 = "meça a temperatura"; espera 5 ms.
        self.i2c.writeto_mem(self.addr, 0xF4, bytes([0x2E]))
        time.sleep_ms(5)
        d = self.i2c.readfrom_mem(self.addr, 0xF6, 2)
        ut = (d[0] << 8) | d[1]                   # temperatura crua
        # Comando 0x34 + (oss << 6) = "meça a pressão" com o nível de resolução escolhido.
        self.i2c.writeto_mem(self.addr, 0xF4, bytes([0x34 + (self.oss << 6)]))
        time.sleep_ms(30)                         # tempo máximo da conversão em alta resolução
        d = self.i2c.readfrom_mem(self.addr, 0xF6, 3)
        up = ((d[0] << 16) | (d[1] << 8) | d[2]) >> (8 - self.oss)   # pressão crua
        temp, pa = self._compensar(ut, up)
        return temp, pa / 100.0                   # devolve (°C, hPa)


def criar_sensor_pressao(i2c):
    # Procura o sensor nos dois endereços possíveis e devolve o objeto certo.
    for addr in (0x76, 0x77):
        try:
            chip = i2c.readfrom_mem(addr, 0xD0, 1)[0]    # lê o ID do chip
        except OSError:                                  # nada respondeu neste endereço
            continue
        if chip in (0x58, 0x60):
            return BMP280(i2c, addr)
        if chip == 0x55:
            return BMP180(i2c, addr)
    raise OSError("Sensor de pressao nao encontrado (0x76 e 0x77). Confira SDA e SCL.")


def pressao_nivel_mar(p_hpa, altitude_m):
    # Fórmula hipsométrica: leva a pressão medida na sua altitude para o nível do mar,
    # que é como a previsão do tempo informa a pressão.
    return p_hpa / (1.0 - altitude_m / 44330.0) ** 5.255

