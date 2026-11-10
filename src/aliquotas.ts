import fs from "node:fs";
import { baixar, textoDe } from "./baixar.ts";
import { lerXlsx, lerXlsxAbas } from "./xlsx.ts";

// II e IPI oficiais de todos os NCMs.
//  - II: planilha "Anexos I a X da Resolução Gecex nº 272/2021" (página Tarifas Vigentes do MDIC/Camex).
//    Base: Anexo II (alíquota brasileira aplicada) quando existe, senão Anexo I (TEC). As exceções
//    temporárias (Anexos IV, V, VI, VIII, IX e X) prevalecem, como diz a nota do Anexo X, mas aqui só entram
//    no II as que valem para o NCM inteiro (sem Ex e sem quota) e estão vigentes; as demais viram aviso.
//  - IPI: tipi.xlsx da Receita Federal (linha sem Ex; "NT" = não tributado).

const PAGINA_TEC = "https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes";
const TIPI_URL = "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.xlsx";

export type Aliquota = {
  ncm: string;
  ii: number | null; // fração
  iiFonte: string | null;
  bitBk: string | null;
  excecoes: string[];
  ipi: number | null; // fração; null quando NT
  ipiNt: boolean;
};

const so8 = (v: string) => (v ?? "").replace(/\D/g, "");
const ehNcm8 = (v: string) => /^\d{4}\.\d{2}\.\d{2}$/.test((v ?? "").trim());

// "12.6", "12,6BK", "0BIT" -> { valor: 0.126, marca: "BK" }
export function lerAliquota(txt: string): { valor: number | null; marca: string | null } {
  const t = (txt ?? "").trim().toUpperCase();
  const marca = /BIT/.test(t) ? "BIT" : /BK/.test(t) ? "BK" : null;
  const n = Number(t.replace(/[A-Z\s%]/g, "").replace(",", "."));
  return { valor: t && Number.isFinite(n) ? n / 100 : null, marca };
}

// Datas das planilhas: número de série do Excel (46043) ou dd/mm/aaaa.
function data(txt: string): Date | null {
  const t = (txt ?? "").trim();
  if (/^\d{5}$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400_000);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}

async function urlDaTec(): Promise<string> {
  if (process.env.TEC_URL) return process.env.TEC_URL;
  const html = await textoDe(PAGINA_TEC);
  const m = /href="([^"]*anexos-i-a-x-resolucao-gecex-272[^"]*\.xlsx)"/i.exec(html);
  if (!m) throw new Error(`Planilha dos Anexos da Res. Gecex 272/2021 não encontrada em ${PAGINA_TEC}; defina TEC_URL.`);
  return m[1];
}

export async function carregarAliquotas(): Promise<{ porNcm: Map<string, Aliquota>; vigencia: string }> {
  const arqTec = await baixar(await urlDaTec(), "tec_anexos_272.xlsx");
  const arqTipi = await baixar(TIPI_URL, "tipi.xlsx");

  const porNcm = new Map<string, Aliquota>();
  const pegar = (ncm: string): Aliquota => {
    let a = porNcm.get(ncm);
    if (!a) {
      a = { ncm, ii: null, iiFonte: null, bitBk: null, excecoes: [], ipi: null, ipiNt: false };
      porNcm.set(ncm, a);
    }
    return a;
  };

  const abas = lerXlsxAbas(fs.readFileSync(arqTec));
  const aba = (prefixo: string) => abas.find((a) => a.nome.toUpperCase().startsWith(prefixo.toUpperCase()));
  const ultimaGecex = abas
    .flatMap((a) => a.linhas.slice(0, 3).map((l) => l[0] ?? ""))
    .filter((t) => /atualizad/i.test(t))
    .map((t) => /Gecex n[ºo°] ?(\d+)/i.exec(t)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => b - a)[0];

  for (const l of aba("Anexo I -")?.linhas ?? []) {
    if (!ehNcm8(l[0])) continue;
    const a = lerAliquota(l[2] ?? "");
    const x = pegar(so8(l[0]));
    x.ii = a.valor;
    x.iiFonte = "Anexo I (TEC)";
    x.bitBk = a.marca;
  }

  const comCabecalho = (nome: string) => {
    const a = aba(nome);
    if (!a) return null;
    const i = a.linhas.findIndex((l) => (l[0] ?? "").trim().toUpperCase() === "NCM");
    if (i < 0) return null;
    const cab = a.linhas[i].map((c) => (c ?? "").trim().toUpperCase());
    return { linhas: a.linhas.slice(i + 1), col: (re: RegExp) => cab.findIndex((c) => re.test(c)) };
  };

  const a2 = comCabecalho("Anexo II");
  if (a2) {
    const iApl = a2.col(/APLICADA/);
    const iTec = a2.col(/^TEC/);
    for (const l of a2.linhas) {
      if (!ehNcm8(l[0])) continue;
      const v = lerAliquota(l[iApl] ?? "").valor ?? lerAliquota(l[iTec] ?? "").valor;
      if (v == null) continue;
      const x = pegar(so8(l[0]));
      x.ii = v;
      x.iiFonte = "Anexo II (aplicada)";
    }
  }

  const hoje = new Date();
  const excecoes: [string, string][] = [
    ["Anexo IV", "Anexo IV (desabastecimento)"],
    ["Anexo V", "Anexo V (LETEC)"],
    ["Anexo VI", "Anexo VI (LEBIT/BK)"],
    ["Anexo VIII", "Anexo VIII (OMC)"],
    ["Anexo IX", "Anexo IX (DCC)"],
    ["Anexo X", "Anexo X (automotivos ACE-14)"],
  ];
  for (const [prefixo, rotulo] of excecoes) {
    const ax = comCabecalho(prefixo + " -");
    if (!ax) continue;
    const iEx = ax.col(/^N[ºO°] ?EX/);
    const iAl = ax.col(/^AL[ÍI]QUOTA/);
    const iQuota = ax.col(/^QUOTA/);
    const iIni = ax.col(/^IN[ÍI]CIO/);
    const iFim = ax.col(/^T[ÉE]RMINO/);
    for (const l of ax.linhas) {
      if (!ehNcm8(l[0])) continue;
      const ex = (l[iEx] ?? "").trim();
      const quota = iQuota >= 0 ? (l[iQuota] ?? "").trim() : "-";
      const ini = iIni >= 0 ? data(l[iIni] ?? "") : null;
      const fim = iFim >= 0 ? data(l[iFim] ?? "") : null;
      if ((ini && ini > hoje) || (fim && fim < hoje)) continue;
      const al = lerAliquota(l[iAl] ?? "");
      const x = pegar(so8(l[0]));
      if ((!ex || ex === "-") && (!quota || quota === "-") && al.valor != null) {
        x.ii = al.valor;
        x.iiFonte = rotulo;
      } else {
        const aviso = `${rotulo}: ${ex && ex !== "-" ? `Ex ${ex}` : "NCM"}${quota && quota !== "-" ? " com quota" : ""} a ${al.valor != null ? `${(al.valor * 100).toLocaleString("pt-BR")}%` : "?"}`;
        if (!x.excecoes.includes(aviso)) x.excecoes.push(aviso);
      }
    }
  }

  const tipi = lerXlsx(fs.readFileSync(arqTipi));
  const atos = tipi.slice(0, 4).join(" ").match(/Ato Declarat[óo]rio Executivo RFB n[ºo°] ?\d+, de [^\r\n]+?\d{4}/gi) ?? [];
  for (const l of tipi) {
    if (!ehNcm8(l[0])) continue;
    const ex = (l[1] ?? "").trim();
    const txt = (l[3] ?? "").trim().toUpperCase();
    const x = pegar(so8(l[0]));
    if (ex) {
      const aviso = `TIPI Ex ${ex}: ${txt === "NT" ? "NT" : `${txt.replace(".", ",")}%`}`;
      if (!x.excecoes.includes(aviso)) x.excecoes.push(aviso);
      continue;
    }
    x.ipiNt = txt === "NT";
    x.ipi = x.ipiNt ? null : lerAliquota(txt).valor;
  }

  const vigencia = `Res. Gecex 272/2021, anexos atualizados até a Res. Gecex nº ${ultimaGecex ?? "?"}; TIPI (${(atos[atos.length - 1] ?? "TIPI 2022").replace(/\s+/g, " ")})`;
  return { porNcm, vigencia };
}
