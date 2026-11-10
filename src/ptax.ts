import { textoDe } from "./baixar.ts";

// PTAX de venda mais recente (Banco Central, API Olinda).
export async function ptaxVenda(): Promise<{ cambio: number; data: string }> {
  if (process.env.CAMBIO) return { cambio: Number(process.env.CAMBIO), data: "informado em CAMBIO" };
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
  const fim = new Date();
  const ini = new Date(fim.getTime() - 15 * 86400_000);
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${fmt(ini)}'&@dataFinalCotacao='${fmt(fim)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
  const j = JSON.parse(await textoDe(url)) as { value?: { cotacaoVenda: number; dataHoraCotacao: string }[] };
  const v = j.value?.[0];
  if (!v) throw new Error("PTAX indisponível no Banco Central; defina CAMBIO.");
  return { cambio: v.cotacaoVenda, data: v.dataHoraCotacao.slice(0, 10) };
}
