
from statistics import median

K = 4.0                     # quantos "desvios robustos" de distância contam como outlier
MINIMO_AMOSTRAS = 5         # só decide com pelo menos 5 leituras recentes de comparação

# Menor salto (em relação à mediana) que pode ser considerado outlier, para cada grandeza.
SALTO_MINIMO = {
    "temperatura": 5.0,       # °C
    "umidade": 20.0,          # %
    "pressao_hpa": 10.0,      # hPa
    "pressao_nm_hpa": 10.0,   # hPa
    "co2_ppm": 800.0,         # ppm (o CO2 varia bastante num ambiente fechado)
}


def eh_outlier(valor, recentes, campo):
    """True se 'valor' está muito longe do que as 'recentes' leituras indicam."""
    if valor is None:
        return False
    recentes = [r for r in recentes if r is not None]
    if len(recentes) < MINIMO_AMOSTRAS:
        return False                                    # poucos dados: não dá para julgar
    med = median(recentes)
    mad = median(abs(r - med) for r in recentes)        # desvio absoluto mediano
    limite = max(K * 1.4826 * mad, SALTO_MINIMO.get(campo, 0.0))
    return abs(valor - med) > limite


def media_movel(valores, janela):
    """Média móvel de uma lista. Valores None são ignorados na conta.
    Cada posição vira a média dos últimos 'janela' valores válidos (incluindo ela)."""
    resultado = []
    for i in range(len(valores)):
        if valores[i] is None:
            resultado.append(None)
            continue
        inicio = max(0, i - janela + 1)
        validos = [v for v in valores[inicio:i + 1] if v is not None]
        resultado.append(round(sum(validos) / len(validos), 2))
    return resultado
