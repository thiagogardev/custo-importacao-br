// Custo nacionalizado de 1 kg importado e teto de preço nacional.
//
// custo líquido = CIF + II + AFRMM + despesas aduaneiras
//   É o que fica no custo de quem importa no regime normal: IPI, PIS, Cofins e ICMS da importação viram crédito.
// desembolso   = custo líquido + IPI + PIS + Cofins + ICMS (por dentro)
// teto         = custo líquido / ((1 − ICMS da venda nacional) × (1 − crédito de PIS/Cofins))
//   Preço por kg na nota (com ICMS, sem IPI) que deixa o comprador nacional com o mesmo custo líquido.
//   Abaixo do teto, comprar no Brasil sai mais barato do que importar. O crédito de PIS/Cofins tem base sem o
//   ICMS (Lei 14.592/2023).

export type Premissas = {
  ii: number; // frações (0.126 = 12,6%)
  ipi: number;
  pis: number;
  cofins: number;
  icms: number; // ICMS da importação
  despesas: number; // despachante, armazenagem, capatazia, Siscomex, sobre o CIF
  afrmm: number; // sobre o frete marítimo
  fretePct: number; // frete / FOB
  seguroPct: number;
  maritimoPct: number; // fatia do FOB que chega por via marítima
  cambio: number; // R$ por US$
};

export type Credito = { icmsVenda: number; pisCofins: number };

export const PADRAO = { pis: 0.021, cofins: 0.0965, icms: 0.18, despesas: 0.03, afrmm: 0.08 };
export const CREDITO_PADRAO: Credito = { icmsVenda: 0.18, pisCofins: 0.0925 };

export type CustoKg = {
  fobUsd: number;
  cif: number;
  ii: number;
  afrmm: number;
  despesas: number;
  ipi: number;
  pis: number;
  cofins: number;
  icms: number;
  liquido: number;
  desembolso: number;
  teto: number;
};

export function custoKg(fobKgUsd: number, p: Premissas, credito: Credito = CREDITO_PADRAO): CustoKg {
  const frete = fobKgUsd * p.fretePct;
  const seguro = fobKgUsd * p.seguroPct;
  const cif = (fobKgUsd + frete + seguro) * p.cambio;
  const ii = cif * p.ii;
  const ipi = (cif + ii) * p.ipi;
  const pis = cif * p.pis;
  const cofins = cif * p.cofins;
  const afrmm = frete * p.cambio * p.maritimoPct * p.afrmm;
  const despesas = cif * p.despesas;
  const semIcms = cif + ii + ipi + pis + cofins + afrmm + despesas;
  const icms = (semIcms / (1 - p.icms)) * p.icms;
  const liquido = cif + ii + afrmm + despesas;
  return {
    fobUsd: fobKgUsd,
    cif,
    ii,
    afrmm,
    despesas,
    ipi,
    pis,
    cofins,
    icms,
    liquido,
    desembolso: semIcms + icms,
    teto: liquido / ((1 - credito.icmsVenda) * (1 - credito.pisCofins)),
  };
}

// Margem de ataque de um preço nacional (R$/kg na nota): positiva = abaixo do custo de importar.
export function margem(teto: number, precoKg: number): number {
  return (teto - precoKg) / teto;
}
