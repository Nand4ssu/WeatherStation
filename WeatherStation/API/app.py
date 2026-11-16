
import os
from datetime import date

from flask import Flask, jsonify, request, send_from_directory

import config
from banco import RepositorioLeituras
from coletor import ColetorMQTT

app = Flask(__name__)
app.json.ensure_ascii = False           # mostra acentos normalmente no JSON (ã, é, ç...)

repo = RepositorioLeituras(config.BANCO, config.FUSO_HORAS)
repo.registrar_estacao(config.ESTACAO_ID, config.ESTACAO_NOME,
                       config.ESTACAO_LATITUDE, config.ESTACAO_LONGITUDE)
coletor = ColetorMQTT(repo, config.MQTT_BROKER, config.MQTT_PORTA, config.MQTT_TOPICO, config.ESTACAO_ID)


# ---------- permite que o site (em outro endereço) leia a API ----------
@app.after_request
def liberar_acesso(resposta):
    resposta.headers["Access-Control-Allow-Origin"] = "*"      # liberado só para leitura (GET)
    return resposta


# ---------- funções auxiliares ----------
def erro(mensagem, codigo=400):
    return jsonify({"erro": mensagem}), codigo

def ler_dia(texto):
    """Transforma '2026-11-13' em uma data. Devolve None se o formato estiver errado."""
    try:
        return date.fromisoformat(texto)
    except (TypeError, ValueError):
        return None


# ---------- rotas ----------
@app.get("/api/saude")
def saude():
    """Mostra se a API, o banco e o MQTT estão funcionando."""
    ultima = repo.ultima(config.ESTACAO_ID)
    return jsonify({
        "ok": True,
        "mqtt_conectado": coletor.conectado,
        "topico": config.MQTT_TOPICO,
        "mensagens_recebidas": coletor.recebidas,
        "leituras_gravadas_nesta_execucao": coletor.gravadas,
        "total_leituras_no_banco": repo.total_leituras(),
        "ultima_leitura": ultima["data_hora"] if ultima else None,
    })

@app.get("/api/estacoes")
def estacoes():
    """Lista as estações cadastradas, com latitude e longitude (para o mapa)."""
    return jsonify(repo.listar_estacoes())

@app.get("/api/ultima")
def ultima():
    """A leitura mais recente. Opcional: ?estacao=ID"""
    estacao = request.args.get("estacao", config.ESTACAO_ID)
    leitura = repo.ultima(estacao)
    if leitura is None:
        return erro("Ainda não há leituras para esta estação.", 404)
    return jsonify(leitura)

@app.get("/api/leituras")
def leituras():
    """Lista leituras. Opcionais: ?estacao=ID&inicio=AAAA-MM-DD&fim=AAAA-MM-DD&limite=500&ordem=asc|desc&media_movel=5"""
    estacao = request.args.get("estacao", config.ESTACAO_ID)
    inicio = fim = None
    texto_ini, texto_fim = request.args.get("inicio"), request.args.get("fim")
    if texto_ini or texto_fim:
        d_ini = ler_dia(texto_ini) if texto_ini else None
        d_fim = ler_dia(texto_fim) if texto_fim else None
        if (texto_ini and d_ini is None) or (texto_fim and d_fim is None):
            return erro("Use datas no formato AAAA-MM-DD, por exemplo 2026-11-13.")
        if d_ini:
            inicio, _ = repo.intervalo_do_dia(d_ini)
        if d_fim:
            _, fim = repo.intervalo_do_dia(d_fim)
    try:
        limite = int(request.args.get("limite", 500))
    except ValueError:
        return erro("O limite precisa ser um número inteiro.")
    limite = max(1, min(limite, 5000))                       # nunca mais que 5000 por vez
    ordem = "asc" if request.args.get("ordem") == "asc" else "desc"
    try:
        janela = int(request.args.get("media_movel", 0))        # 0 = sem média móvel
    except ValueError:
        return erro("media_movel precisa ser um número inteiro (ex.: 5).")
    if not 0 <= janela <= 100:
        return erro("media_movel deve ficar entre 0 e 100.")
    dados = repo.listar(estacao, inicio, fim, limite, ordem)
    if janela > 1:
        # a média só faz sentido em ordem cronológica; se a lista veio do mais novo, inverte e desinverte
        cronologica = list(reversed(dados)) if ordem == "desc" else dados
        repo.com_media_movel(cronologica, janela)
    return jsonify({"estacao": estacao, "quantidade": len(dados), "media_movel": janela or None, "leituras": dados})

@app.get("/api/resumo")
def resumo():
    """Mínimo, máximo e média de um dia. ?dia=AAAA-MM-DD (se faltar, usa hoje) &estacao=ID"""
    estacao = request.args.get("estacao", config.ESTACAO_ID)
    texto = request.args.get("dia")
    dia = ler_dia(texto) if texto else hoje_local()
    if dia is None:
        return erro("Use a data no formato AAAA-MM-DD, por exemplo 2026-11-13.")
    return jsonify(repo.resumo(estacao, dia))

def hoje_local():
    from datetime import datetime
    return datetime.now(repo.fuso).date()


# ---------- o site (dashboard) ----------
# Só estas quatro coisas são entregues: index.html e as pastas CSS, JS e SRC.
# As pastas ESP32 (com a senha do Wi-Fi) e API (com o banco) NUNCA são entregues.
if config.PASTA_SITE:
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0         # em desenvolvimento, sempre o arquivo mais novo

    @app.get("/")
    def pagina_inicial():
        return send_from_directory(config.PASTA_SITE, "index.html")

    @app.get("/<any(CSS,JS,SRC):pasta>/<path:arquivo>")
    def arquivos_do_site(pasta, arquivo):
        # send_from_directory recusa caminhos que tentem sair da pasta (como ../)
        return send_from_directory(os.path.join(config.PASTA_SITE, pasta), arquivo)
else:
    @app.get("/")
    def inicio():
        return jsonify({"api": "Estação meteorológica TechGirls", "rotas": [
            "/api/saude", "/api/estacoes", "/api/ultima", "/api/leituras", "/api/resumo"]})


if __name__ == "__main__":
    coletor.iniciar()
    if config.PASTA_SITE:
        print(f"[SITE] abra no navegador: http://127.0.0.1:{config.API_PORTA}")
    # use_reloader=False: sem isso o Flask abriria o coletor duas vezes
    app.run(host=config.API_HOST, port=config.API_PORTA, debug=False, use_reloader=False)
