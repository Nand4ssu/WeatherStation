
import math
import sqlite3

import tratamento
from datetime import datetime, timedelta, timezone

# Campos numéricos aceitos e a faixa que faz sentido para cada um.
# Um valor fora da faixa (sensor com defeito, mensagem falsa) vira "sem dado".
FAIXAS = {
    "temperatura": (-40.0, 85.0),       # °C
    "umidade": (0.0, 100.0),            # %
    "pressao_hpa": (300.0, 1100.0),     # hPa
    "pressao_nm_hpa": (300.0, 1100.0),  # hPa
    "co2_ppm": (0.0, 100000.0),         # ppm
    "chuva_mm": (0.0, 500.0),           # mm no intervalo
    "chuva_mm_h": (0.0, 1500.0),        # mm/h
    "chuva_total_mm": (0.0, 100000.0),  # mm acumulados
}
CAMPOS_RESUMO = [c for c in FAIXAS if c not in ("chuva_mm", "chuva_total_mm")]   # a chuva tem conta própria (soma)
CAMPOS_SUAVIZAVEIS = ["temperatura", "umidade", "pressao_hpa", "pressao_nm_hpa", "co2_ppm", "chuva_mm_h"]


def agora_utc():
    return datetime.now(timezone.utc)


class RepositorioLeituras:
    def __init__(self, caminho_banco, fuso_horas=-3):
        self.caminho = caminho_banco
        self.fuso = timezone(timedelta(hours=fuso_horas))   # fuso local (para separar os dias)
        self.criar_tabelas()

    # ---------- conexão ----------
    def _conectar(self):
        conn = sqlite3.connect(self.caminho, timeout=10)    # espera até 10 s se o banco estiver ocupado
        conn.row_factory = sqlite3.Row                      # permite usar linha["temperatura"]
        return conn

    # ---------- criação das tabelas ----------
    def criar_tabelas(self):
        conn = self._conectar()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS estacoes (
                    id TEXT PRIMARY KEY,
                    nome TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL
                )""")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS leituras (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    estacao_id TEXT NOT NULL REFERENCES estacoes(id),
                    data_hora TEXT NOT NULL,          -- sempre em UTC, ex.: 2026-11-13T17:59:00+00:00
                    temperatura REAL,
                    umidade REAL,
                    pressao_hpa REAL,
                    pressao_nm_hpa REAL,
                    luminosidade TEXT,                -- 'claro' ou 'escuro'
                    co2_ppm REAL,
                    gas_alerta INTEGER,               -- 1 = alerta de gás, 0 = normal
                    chuva_mm REAL,                    -- chuva no intervalo (mm)
                    chuva_mm_h REAL,                  -- intensidade (mm/h)
                    chuva_total_mm REAL,              -- acumulado desde que a placa ligou (mm)
                    descartados TEXT                  -- campos removidos como outlier (ex.: 'temperatura')
                )""")
            # Bancos criados na versão anterior ganham as colunas novas, sem perder os dados
            existentes = {c["name"] for c in conn.execute("PRAGMA table_info(leituras)")}
            for coluna, tipo in (("chuva_mm", "REAL"), ("chuva_mm_h", "REAL"), ("chuva_total_mm", "REAL"), ("descartados", "TEXT")):
                if coluna not in existentes:
                    conn.execute(f"ALTER TABLE leituras ADD COLUMN {coluna} {tipo}")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_leituras_estacao_data ON leituras (estacao_id, data_hora)")
            conn.commit()
        finally:
            conn.close()

    # ---------- estações ----------
    def registrar_estacao(self, estacao_id, nome, latitude=None, longitude=None):
        """Cria a estação, ou atualiza o nome e as coordenadas se ela já existir."""
        conn = self._conectar()
        try:
            conn.execute(
                """INSERT INTO estacoes (id, nome, latitude, longitude) VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET nome = excluded.nome,
                       latitude = COALESCE(excluded.latitude, estacoes.latitude),
                       longitude = COALESCE(excluded.longitude, estacoes.longitude)""",
                (estacao_id, nome, latitude, longitude))
            conn.commit()
        finally:
            conn.close()

    def garantir_estacao(self, estacao_id):
        """Se chegar uma estação nova (ainda não cadastrada), cadastra com o próprio id como nome."""
        conn = self._conectar()
        try:
            conn.execute("INSERT OR IGNORE INTO estacoes (id, nome) VALUES (?, ?)", (estacao_id, estacao_id))
            conn.commit()
        finally:
            conn.close()

    def listar_estacoes(self):
        conn = self._conectar()
        try:
            linhas = conn.execute("""
                SELECT e.id, e.nome, e.latitude, e.longitude,
                       (SELECT COUNT(*) FROM leituras l WHERE l.estacao_id = e.id) AS total_leituras
                FROM estacoes e ORDER BY e.id""").fetchall()
            return [dict(l) for l in linhas]
        finally:
            conn.close()

    # ---------- limpeza dos dados que chegam ----------
    @staticmethod
    def limpar(dados):
        """Recebe o JSON do ESP32 e devolve só os campos válidos. O que for estranho vira None."""
        limpo = {}
        for campo, (minimo, maximo) in FAIXAS.items():
            v = dados.get(campo)
            ok = (isinstance(v, (int, float)) and not isinstance(v, bool)
                  and math.isfinite(v) and minimo <= v <= maximo)
            limpo[campo] = float(v) if ok else None
        lum = dados.get("luminosidade")
        limpo["luminosidade"] = lum if lum in ("claro", "escuro") else None
        gas = dados.get("gas_alerta")
        limpo["gas_alerta"] = int(bool(gas)) if isinstance(gas, (bool, int)) and gas in (True, False, 0, 1) else None
        return limpo

    # ---------- gravar ----------
    def valores_recentes(self, estacao_id, campo, quantidade=10):
        """Os últimos valores válidos de um campo (para comparar com a leitura nova)."""
        if campo not in FAIXAS:                              # só nomes de coluna conhecidos entram no SQL
            return []
        conn = self._conectar()
        try:
            linhas = conn.execute(
                f"SELECT {campo} FROM leituras WHERE estacao_id = ? AND {campo} IS NOT NULL ORDER BY id DESC LIMIT ?",
                (estacao_id, int(quantidade))).fetchall()
            return [l[0] for l in linhas]
        finally:
            conn.close()

    def salvar(self, estacao_id, dados, quando=None):
        """Grava uma leitura. Devolve o id da linha, ou None se a mensagem não tinha nenhum dado útil.
        Antes de gravar, descarta os outliers (valores fora da curva) e anota quais foram."""
        limpo = self.limpar(dados)
        # 1) Valores enviados mas impossíveis (fora da faixa do sensor, texto no lugar de número...)
        descartados = [c for c in FAIXAS if dados.get(c) is not None and limpo[c] is None]
        # 2) Valores possíveis, porém muito fora da curva das leituras recentes (outliers estatísticos)
        for campo in tratamento.SALTO_MINIMO:
            if tratamento.eh_outlier(limpo[campo], self.valores_recentes(estacao_id, campo), campo):
                limpo[campo] = None                          # o valor estranho NÃO entra no banco
                descartados.append(campo)
        if all(v is None for v in limpo.values()):
            return None
        quando = (quando or agora_utc()).astimezone(timezone.utc)
        self.garantir_estacao(estacao_id)
        conn = self._conectar()
        try:
            cur = conn.execute(
                """INSERT INTO leituras (estacao_id, data_hora, temperatura, umidade, pressao_hpa,
                                         pressao_nm_hpa, luminosidade, co2_ppm, gas_alerta,
                                         chuva_mm, chuva_mm_h, chuva_total_mm, descartados)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (estacao_id, quando.isoformat(timespec="seconds"), limpo["temperatura"], limpo["umidade"],
                 limpo["pressao_hpa"], limpo["pressao_nm_hpa"], limpo["luminosidade"], limpo["co2_ppm"],
                 limpo["gas_alerta"], limpo["chuva_mm"], limpo["chuva_mm_h"], limpo["chuva_total_mm"],
                 ",".join(descartados) or None))
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    # ---------- converter uma linha do banco em dicionário para o JSON ----------
    def _linha_para_dict(self, linha):
        d = dict(linha)
        utc = datetime.fromisoformat(d["data_hora"])
        d["data_hora_utc"] = d["data_hora"]
        d["data_hora"] = utc.astimezone(self.fuso).isoformat(timespec="seconds")   # hora local, com o fuso
        d["gas_alerta"] = None if d["gas_alerta"] is None else bool(d["gas_alerta"])
        d["descartados"] = d["descartados"].split(",") if d.get("descartados") else []
        return d

    # ---------- dia local -> intervalo em UTC ----------
    def intervalo_do_dia(self, dia_inicio, dia_fim=None):
        """dia_inicio e dia_fim são datas (AAAA-MM-DD) no fuso local. O dia final entra por inteiro."""
        dia_fim = dia_fim or dia_inicio
        ini = datetime(dia_inicio.year, dia_inicio.month, dia_inicio.day, tzinfo=self.fuso)
        fim = datetime(dia_fim.year, dia_fim.month, dia_fim.day, tzinfo=self.fuso) + timedelta(days=1)
        return (ini.astimezone(timezone.utc).isoformat(timespec="seconds"),
                fim.astimezone(timezone.utc).isoformat(timespec="seconds"))

    # ---------- consultas ----------
    def ultima(self, estacao_id):
        conn = self._conectar()
        try:
            linha = conn.execute(
                "SELECT * FROM leituras WHERE estacao_id = ? ORDER BY data_hora DESC, id DESC LIMIT 1",
                (estacao_id,)).fetchone()
            return self._linha_para_dict(linha) if linha else None
        finally:
            conn.close()

    def listar(self, estacao_id, inicio_utc=None, fim_utc=None, limite=500, ordem="desc"):
        ordem_sql = "ASC" if ordem == "asc" else "DESC"      # só dois valores possíveis: nunca vem do usuário direto
        sql = "SELECT * FROM leituras WHERE estacao_id = ?"
        params = [estacao_id]
        if inicio_utc:
            sql += " AND data_hora >= ?"; params.append(inicio_utc)
        if fim_utc:
            sql += " AND data_hora < ?"; params.append(fim_utc)
        sql += f" ORDER BY data_hora {ordem_sql}, id {ordem_sql} LIMIT ?"
        params.append(int(limite))
        conn = self._conectar()
        try:
            return [self._linha_para_dict(l) for l in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def resumo(self, estacao_id, dia):
        """Mínimo, máximo e média de cada grandeza em um dia (no fuso local)."""
        inicio, fim = self.intervalo_do_dia(dia)
        colunas = ", ".join(f"MIN({c}) AS {c}_min, MAX({c}) AS {c}_max, AVG({c}) AS {c}_media" for c in CAMPOS_RESUMO)
        conn = self._conectar()
        try:
            l = conn.execute(
                f"""SELECT COUNT(*) AS total, {colunas},
                           SUM(CASE WHEN luminosidade = 'claro' THEN 1 ELSE 0 END) AS leituras_claro,
                           SUM(CASE WHEN luminosidade = 'escuro' THEN 1 ELSE 0 END) AS leituras_escuro,
                           SUM(CASE WHEN gas_alerta = 1 THEN 1 ELSE 0 END) AS alertas_gas,
                           SUM(chuva_mm) AS chuva_dia_mm
                    FROM leituras WHERE estacao_id = ? AND data_hora >= ? AND data_hora < ?""",
                (estacao_id, inicio, fim)).fetchone()
        finally:
            conn.close()
        arred = lambda x: None if x is None else round(x, 2)
        resumo = {"estacao": estacao_id, "dia": dia.isoformat(), "total_leituras": l["total"]}
        for c in CAMPOS_RESUMO:
            resumo[c] = {"min": arred(l[c + "_min"]), "max": arred(l[c + "_max"]), "media": arred(l[c + "_media"])}
        resumo["luminosidade"] = {"leituras_claro": l["leituras_claro"] or 0, "leituras_escuro": l["leituras_escuro"] or 0}
        resumo["alertas_gas"] = l["alertas_gas"] or 0
        resumo["chuva_total_dia_mm"] = arred(l["chuva_dia_mm"]) or 0.0       # soma da chuva de todos os intervalos do dia
        return resumo

    def com_media_movel(self, leituras_em_ordem_cronologica, janela):
        """Acrescenta a cada leitura os campos <grandeza>_mm (média móvel). A lista deve estar do mais antigo ao mais novo."""
        for campo in CAMPOS_SUAVIZAVEIS:
            suave = tratamento.media_movel([l[campo] for l in leituras_em_ordem_cronologica], janela)
            for leitura, valor in zip(leituras_em_ordem_cronologica, suave):
                leitura[campo + "_mm"] = valor
        return leituras_em_ordem_cronologica

    def total_leituras(self):
        conn = self._conectar()
        try:
            return conn.execute("SELECT COUNT(*) FROM leituras").fetchone()[0]
        finally:
            conn.close()
