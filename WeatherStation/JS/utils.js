

(function () {
  "use strict";
  const U = (Estacao.util = {});

  /* Atalho para document.getElementById("x") -> $("x") */
  U.$ = (id) => document.getElementById(id);

  /* Lê o valor de uma variável CSS, ex.: cor("--c-temperatura") -> "#0E5DB8".
     Assim os gráficos usam as mesmas cores do CSS (inclusive no modo escuro). */
  U.cor = (variavel) => getComputedStyle(document.documentElement).getPropertyValue(variavel).trim();

  /* true se v é um número de verdade (não nulo, não NaN, não texto) */
  U.valido = (v) => typeof v === "number" && Number.isFinite(v);

  /* Formata número no padrão brasileiro: 1013.2 -> "1.013,2".
     Se o valor for inválido, mostra "--". */
  U.fmt = (v, casas) => (!U.valido(v)) ? "--"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

  /* Data -> "14:35:07" */
  U.hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  /* Cria um elemento SVG com atributos e (opcionalmente) o anexa a um pai.
     Ex.: el("line", {x1: 0, x2: 10}, svg) */
  const NS_SVG = "http://www.w3.org/2000/svg";
  U.el = (nome, atributos, pai) => {
    const e = document.createElementNS(NS_SVG, nome);
    for (const k in atributos) e.setAttribute(k, atributos[k]);
    if (pai) pai.appendChild(e);
    return e;
  };
})();
