import fs from "node:fs";
import readline from "node:readline";
import { baixar } from "./baixar.ts";

// Comex Stat (MDIC), base bruta de importação por NCM: IMP_<ano>.csv.
// Colunas: CO_ANO;CO_MES;CO_NCM;CO_UNID;CO_PAIS;SG_UF_NCM;CO_VIA;CO_URF;QT_ESTAT;KG_LIQUIDO;VL_FOB;VL_FRETE;VL_SEGURO

const BASE = process.env.COMEX_BASE_URL ?? "https://balanca.mdic.gov.br/balanca/bd";
const VIA_MARITIMA = "01";
const CHINA = "160";

export type AgregadoNcm = {
  ncm: string;
  unidade: string | null; // CO_UNID
  fob12: number;
  kg12: number;
  qt12: number;
  frete12: number;
  seguro12: number;
  fobMar12: number;
  meses12: number;
  fobAnterior: number; // 12 meses anteriores
  fobChina12: number;
  paises12: Map<string, number>;
};

// Separa por ";" respeitando aspas (descrições de NCM podem ter ";").
function separar(l: string): string[] {
  if (!l.includes('"')) return l.split(";");
  const out: string[] = [];
  let atual = "";
  let dentro = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') {
      if (dentro && l[i + 1] === '"') {
        atual += '"';
        i++;
      } else dentro = !dentro;
    } else if (ch === ";" && !dentro) {
      out.push(atual);
      atual = "";
    } else atual += ch;
  }
  out.push(atual);
  return out;
}

async function* linhas(arquivo: string): AsyncGenerator<string[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(arquivo, { encoding: "latin1" }), crlfDelay: Infinity });
  let primeira = true;
  for await (const l of rl) {
    if (primeira) {
      primeira = false;
      continue;
    }
    if (l) yield separar(l);
  }
}

export async function tabelaComex(nome: string): Promise<string> {
  return baixar(`${BASE}/tabelas/${nome}`, nome, 30);
}

export async function descricoesNcm(): Promise<Map<string, { descricao: string; unidade: string }>> {
  const m = new Map<string, { descricao: string; unidade: string }>();
  for await (const c of linhas(await tabelaComex("NCM.csv"))) if (/^\d{8}$/.test(c[0])) m.set(c[0], { unidade: c[1], descricao: c[11] ?? "" });
  return m;
}

export async function unidades(): Promise<Map<string, { nome: string; sigla: string }>> {
  const m = new Map<string, { nome: string; sigla: string }>();
  for await (const c of linhas(await tabelaComex("NCM_UNIDADE.csv"))) m.set(c[0], { nome: c[1], sigla: (c[2] ?? "").trim() });
  return m;
}

export async function nomesPaises(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for await (const c of linhas(await tabelaComex("PAIS.csv"))) m.set(c[0], c[3] ?? c[0]);
  return m;
}

// Último mês publicado: lê o arquivo do ano corrente (ou do anterior, em janeiro antes da publicação).
async function arquivoAno(ano: number, validadeDias: number): Promise<string | null> {
  try {
    return await baixar(`${BASE}/comexstat-bd/ncm/IMP_${ano}.csv`, `IMP_${ano}.csv`, validadeDias);
  } catch (e) {
    if (String((e as Error).message).includes("HTTP 404")) return null;
    throw e;
  }
}

// Agrega os 12 meses mais recentes publicados (e os 12 anteriores, para o crescimento).
// Com `soNcm`, varre os arquivos mas guarda só aquele NCM.
export async function agregarComex(opts: { soNcm?: string } = {}): Promise<{ porNcm: Map<string, AgregadoNcm>; de: string; ate: string }> {
  const atual = new Date().getFullYear();
  const arquivos: { ano: number; arq: string }[] = [];
  for (const ano of [atual - 2, atual - 1, atual]) {
    const arq = await arquivoAno(ano, ano === atual ? 7 : 365);
    if (arq) arquivos.push({ ano, arq });
  }
  // descobre o último mês publicado
  let fim = 0;
  const ultimo = arquivos[arquivos.length - 1];
  for await (const c of linhas(ultimo.arq)) {
    const p = Number(c[0]) * 12 + Number(c[1]) - 1;
    if (p > fim) fim = p;
  }
  const porNcm = new Map<string, AgregadoNcm>();
  const mesesVistos = new Map<string, Set<number>>();
  for (const { arq } of arquivos) {
    for await (const c of linhas(arq)) {
      const ncm = c[2];
      if (opts.soNcm && ncm !== opts.soNcm) continue;
      const p = Number(c[0]) * 12 + Number(c[1]) - 1;
      if (p <= fim - 24 || p > fim) continue;
      let a = porNcm.get(ncm);
      if (!a) {
        a = { ncm, unidade: c[3] || null, fob12: 0, kg12: 0, qt12: 0, frete12: 0, seguro12: 0, fobMar12: 0, meses12: 0, fobAnterior: 0, fobChina12: 0, paises12: new Map() };
        porNcm.set(ncm, a);
      }
      const fob = Number(c[10]) || 0;
      if (p > fim - 12) {
        a.fob12 += fob;
        a.kg12 += Number(c[9]) || 0;
        a.qt12 += Number(c[8]) || 0;
        a.frete12 += Number(c[11]) || 0;
        a.seguro12 += Number(c[12]) || 0;
        if (c[6] === VIA_MARITIMA) a.fobMar12 += fob;
        if (c[4] === CHINA) a.fobChina12 += fob;
        a.paises12.set(c[4], (a.paises12.get(c[4]) ?? 0) + fob);
        if (fob > 0) {
          const s = mesesVistos.get(ncm) ?? new Set<number>();
          s.add(p);
          mesesVistos.set(ncm, s);
        }
      } else a.fobAnterior += fob;
    }
  }
  for (const [ncm, s] of mesesVistos) porNcm.get(ncm)!.meses12 = s.size;
  const txt = (p: number) => `${Math.floor(p / 12)}-${String((p % 12) + 1).padStart(2, "0")}`;
  return { porNcm, de: txt(fim - 11), ate: txt(fim) };
}
