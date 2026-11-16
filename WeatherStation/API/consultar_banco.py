
import argparse
import os
import sqlite3
import time

import config

COLUNAS = ["id", "estacao_id", "data_hora", "temperatura", "umidade", "pressao_nm_hpa",
           "luminosidade", "co2_ppm", "gas_alerta", "chuva_mm", "chuva_mm_h", "descartados"]


def conectar():
    if not os.path.exists(config.BANCO):
        raise SystemExit(f"Banco '{config.BANCO}' não encontrado. Rode antes: python app.py")
    conn = sqlite3.connect(f"file:{config.BANCO}?mode=ro", uri=True)    # mode=ro: somente leitura
    conn.row_factory = sqlite3.Row
    return conn


def tabela(linhas, colunas):
    if not linhas:
        print("(nenhuma linha)")
        return
    textos = [[("" if l[c] is None else str(l[c])) for c in colunas] for l in linhas]
    larguras = [max(len(c), *(len(t[i]) for t in textos)) for i, c in enumerate(colunas)]
    print("  ".join(c.ljust(larguras[i]) for i, c in enumerate(colunas)))
    print("  ".join("-" * w for w in larguras))
    for t in textos:
        print("  ".join(v.ljust(larguras[i]) for i, v in enumerate(t)))


def ultimas(conn, n):
    print(f"As {n} últimas leituras (SELECT ... ORDER BY id DESC LIMIT {n}):\n")
    linhas = conn.execute(f"SELECT {', '.join(COLUNAS)} FROM leituras ORDER BY id DESC LIMIT ?", (n,)).fetchall()
    tabela(linhas, COLUNAS)


def main():
    p = argparse.ArgumentParser(description="Consulta o banco de leituras da estação (somente leitura).")
    p.add_argument("-n", type=int, default=10, help="quantidade de leituras (padrão 10)")
    p.add_argument("--seguir", action="store_true", help="atualiza a tela a cada 2 segundos")
    p.add_argument("--contagem", action="store_true", help="total de leituras por estação")
    p.add_argument("--descartes", action="store_true", help="leituras com valores removidos como outlier")
    a = p.parse_args()
    conn = conectar()
    if a.contagem:
        tabela(conn.execute("SELECT e.id, e.nome, COUNT(l.id) AS leituras FROM estacoes e "
                            "LEFT JOIN leituras l ON l.estacao_id = e.id GROUP BY e.id").fetchall(), ["id", "nome", "leituras"])
    elif a.descartes:
        tabela(conn.execute(f"SELECT {', '.join(COLUNAS)} FROM leituras WHERE descartados IS NOT NULL "
                            "ORDER BY id DESC LIMIT ?", (a.n,)).fetchall(), COLUNAS)
    elif a.seguir:
        try:
            while True:
                print("\033[2J\033[H", end="")                       # limpa a tela
                ultimas(conn, a.n)
                print("\n(Ctrl + C para sair)")
                time.sleep(2)
        except KeyboardInterrupt:
            print()
    else:
        ultimas(conn, a.n)


if __name__ == "__main__":
    main()
