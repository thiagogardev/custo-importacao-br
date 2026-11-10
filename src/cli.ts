#!/usr/bin/env node
import fs from "node:fs";
import { carregarAliquotas } from "./aliquotas.ts";
import { agregarComex, descricoesNcm, nomesPaises, unidades, type AgregadoNcm } from "./comexstat.ts";
import { CREDITO_PADRAO, custoKg, margem, PADRAO, type Credito, type Premissas } from "./custo.ts";
import { ptaxVenda } from "./ptax.ts";

// Uso:
//   npm run ncm -- 40093100                       custo e teto de um NCM, com a conta aberta
//   npm run ncm -- 40093100 --preco-kg 38         + margem de um preço nacional (R$/kg na nota)
//   npm run ncm -- 40093100 --fob-kg 4.63         usa um FOB por kg seu, em vez da média nacional
//   npm run todos -- --saida ncms.csv             todos os NCMs importados nos últimos 12 meses
// Premissas (em %): --icms 18 --despesas 3 --icms-venda 18 --pis-cofins 9.25

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (n: string, padrao: number) => {
  const v = opt(n);
  return v == null ? padrao : Number(v.replace(",", ".")) / 100;
};
const premissasBase = { ...PADRAO, icms: num("icms", PADRAO.icms), despesas: num("despesas", PADRAO.despesas) };
const credito: Credito = { icmsVenda: num("icms-venda", CREDITO_PADRAO.icmsVenda), pisCofins: num("pis-cofins", CREDITO_PADRAO.pisCofins) };

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const pct = (v: number, c = 1) => `${(v * 100).toFixed(c).replace(".", ",")}%`;
const usd = (v: number) => (v >= 1e6 ? `US$ ${(v / 1e6).toFixed(1)} mi` : `US$ ${Math.round(v / 1e3)} mil`);
const fmtNcm = (n: string) => `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}`;

function premissasDe(a: AgregadoNcm, ii: number, ipi: number, cambio: number): Premissas {
  return {
    ...premissasBase,
    ii,
    ipi,
    fretePct: a.fob12 > 0 ? a.frete12 / a.fob12 : 0,
    seguroPct: a.fob12 > 0 ? a.seguro12 / a.fob12 : 0,
    maritimoPct: a.fob12 > 0 ? a.fobMar12 / a.fob12 : 0,
    cambio,
  };
}

async function umNcm(ncm: string) {
  const [{ porNcm: aliq, vigencia }, comex, cx, desc, unid, paises] = await Promise.all([
    carregarAliquotas(),
    agregarComex({ soNcm: ncm }),
    ptaxVenda(),
    descricoesNcm(),
    unidades(),
    nomesPaises(),
  ]);
  const a = comex.porNcm.get(ncm);
  const al = aliq.get(ncm);
  if (!a || a.fob12 <= 0) throw new Error(`NCM ${ncm} sem importação entre ${comex.de} e ${comex.ate}.`);
  if (al?.ii == null) throw new Error(`NCM ${ncm} sem II na TEC.`);
  const fobKg = opt("fob-kg") ? Number(opt("fob-kg")!.replace(",", ".")) : a.fob12 / a.kg12;
  const p = premissasDe(a, al.ii, al.ipi ?? 0, cx.cambio);
  const c = custoKg(fobKg, p, credito);
  const d = desc.get(ncm);
  const u = d ? unid.get(d.unidade) : undefined;
  const topPaises = [...a.paises12.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);

  console.log(`\n${fmtNcm(ncm)}  ${d?.descricao ?? ""}`);
  console.log(`Período ${comex.de} a ${comex.ate} · PTAX ${cx.cambio.toFixed(4)} (${cx.data})`);
  console.log(`Mercado: ${usd(a.fob12)} em ${a.meses12} de 12 meses` + (a.fobAnterior > 0 ? ` (${a.fob12 >= a.fobAnterior ? "+" : ""}${pct(a.fob12 / a.fobAnterior - 1, 0)} sobre os 12 anteriores)` : ""));
  console.log(`Origem: ${topPaises.map(([co, v]) => `${paises.get(co) ?? co} ${pct(v / a.fob12, 0)}`).join(", ")}`);
  console.log(`Alíquotas: II ${pct(al.ii)} (${al.iiFonte}${al.bitBk ? `, ${al.bitBk}` : ""}) · IPI ${al.ipiNt ? "NT" : pct(al.ipi ?? 0)}${al.excecoes.length ? `\n  exceções: ${al.excecoes.join("; ")}` : ""}`);
  console.log(`Fontes: Comex Stat (MDIC); ${vigencia}; PTAX (BCB)\n`);
  console.log(`Custo de importar 1 kg a US$ ${fobKg.toFixed(2)}${opt("fob-kg") ? " (informado)" : " (média nacional do NCM)"}:`);
  const linha = (r: string, v: number) => console.log(`  ${r.padEnd(44)} ${brl(v).padStart(12)}`);
  linha(`CIF (frete ${pct(p.fretePct, 2)}, seguro ${pct(p.seguroPct, 3)})`, c.cif);
  linha(`II ${pct(p.ii)}`, c.ii);
  linha(`AFRMM 8% do frete marítimo (${pct(p.maritimoPct, 0)} marítimo)`, c.afrmm);
  linha(`Despesas aduaneiras ${pct(p.despesas)}`, c.despesas);
  linha("= Custo líquido (sem os recuperáveis)", c.liquido);
  linha(`+ IPI, PIS, Cofins e ICMS ${pct(p.icms, 0)} (recuperáveis)`, c.ipi + c.pis + c.cofins + c.icms);
  linha("= Desembolso", c.desembolso);
  console.log(`\nTeto de preço nacional: ${brl(c.teto)}/kg na nota (ICMS ${pct(credito.icmsVenda, 0)}, crédito PIS/Cofins ${pct(credito.pisCofins, 2)})`);
  if (u && d && d.unidade !== "10" && a.qt12 > 0) console.log(`  por ${u.sigla.toLowerCase()}: ${brl((c.teto * a.kg12) / a.qt12)} (peso médio ${(a.kg12 / a.qt12).toFixed(3)} kg)`);
  const preco = opt("preco-kg");
  if (preco) {
    const m = margem(c.teto, Number(preco.replace(",", ".")));
    console.log(`Margem do seu preço de ${brl(Number(preco.replace(",", ".")))}/kg: ${m >= 0 ? "+" : ""}${pct(m, 0)} ${m >= 0 ? "(abaixo do custo de importar)" : "(acima do custo de importar)"}`);
  }
  console.log("\nA média nacional mistura todos os produtos do NCM. Para um produto específico, use --fob-kg com o preço dele.");
}

async function todos(saida: string) {
  const [{ porNcm: aliq }, comex, cx, desc, unid] = await Promise.all([carregarAliquotas(), agregarComex(), ptaxVenda(), descricoesNcm(), unidades()]);
  const cab = ["ncm", "descricao", "fob_12m_usd", "fob_12m_anteriores_usd", "crescimento", "meses", "fob_kg_usd", "unidade", "fob_unidade_usd", "frete_pct", "maritimo_pct", "ii", "ii_fonte", "ipi", "custo_liquido_kg_brl", "desembolso_kg_brl", "teto_kg_brl", "teto_unidade_brl", "china_pct"];
  const linhas: string[] = [cab.join(";")];
  const csv = (v: string | number | null) => (v == null ? "" : typeof v === "number" ? String(Number(v.toFixed(6))) : `"${v.replace(/"/g, '""')}"`);
  const itens = [...comex.porNcm.values()].filter((a) => a.fob12 > 0).sort((x, y) => y.fob12 - x.fob12);
  for (const a of itens) {
    const al = aliq.get(a.ncm);
    const d = desc.get(a.ncm);
    const u = d ? unid.get(d.unidade) : undefined;
    const fobKg = a.kg12 > 0 ? a.fob12 / a.kg12 : null;
    const c = fobKg != null && al?.ii != null ? custoKg(fobKg, premissasDe(a, al.ii, al.ipi ?? 0, cx.cambio), credito) : null;
    const porUnid = d && d.unidade !== "10" && a.qt12 > 0;
    linhas.push(
      [
        a.ncm,
        d?.descricao ?? "",
        a.fob12,
        a.fobAnterior,
        a.fobAnterior > 0 ? a.fob12 / a.fobAnterior - 1 : null,
        a.meses12,
        fobKg,
        u?.sigla ?? "",
        porUnid ? a.fob12 / a.qt12 : null,
        a.frete12 / a.fob12,
        a.fobMar12 / a.fob12,
        al?.ii ?? null,
        al?.iiFonte ?? "",
        al?.ipiNt ? null : (al?.ipi ?? null),
        c?.liquido ?? null,
        c?.desembolso ?? null,
        c?.teto ?? null,
        c && porUnid ? (c.teto * a.kg12) / a.qt12 : null,
        a.fobChina12 / a.fob12,
      ]
        .map(csv)
        .join(";"),
    );
  }
  fs.writeFileSync(saida, "﻿" + linhas.join("\r\n"), "utf8");
  console.log(`${itens.length} NCMs (${comex.de} a ${comex.ate}, PTAX ${cx.cambio}) gravados em ${saida}`);
}

const ncm = args.find((a) => /^\d{4}\.?\d{2}\.?\d{2}$/.test(a))?.replace(/\D/g, "");
(args.includes("--todos") ? todos(opt("saida") ?? "custo-importacao.csv") : ncm ? umNcm(ncm) : Promise.reject(new Error("Informe um NCM de 8 dígitos ou --todos.")))
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
