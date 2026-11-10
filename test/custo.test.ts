import assert from "node:assert/strict";
import test from "node:test";
import { lerAliquota } from "../src/aliquotas.ts";
import { custoKg, margem, PADRAO } from "../src/custo.ts";

// Caso real e público: NCM 4009.31.00 (mangueira de borracha com reforço têxtil), 09/11/2026.
// FOB US$ 4,63/kg; frete 5,79% e seguro 0,075% do FOB, 89% marítimo (Comex Stat); II 12,6% e IPI 6,5%
// (Res. Gecex 272/2021 e TIPI); PTAX R$ 5,5146.
const p = { ...PADRAO, ii: 0.126, ipi: 0.065, fretePct: 0.0578968, seguroPct: 0.000746351, maritimoPct: 0.888108, cambio: 5.5146 };

test("custo líquido, desembolso e teto do 4009.31.00", () => {
  const c = custoKg(4.63, p);
  // tolerância de 1 centavo: o FOB de referência do caso tem mais casas que 4,63
  const perto = (v: number, esperado: number) => assert.ok(Math.abs(v - esperado) <= 0.011, `${v.toFixed(4)} longe de ${esperado}`);
  perto(c.cif, 27.03);
  perto(c.ii, 3.41);
  perto(c.afrmm, 0.11);
  perto(c.despesas, 0.81);
  perto(c.liquido, 31.35);
  perto(c.desembolso, 44.51);
  perto(c.teto, 42.13);
});

test("ICMS por dentro: o ICMS é a alíquota sobre a base que já o contém", () => {
  const c = custoKg(4.63, p);
  const base = c.desembolso; // CIF + tributos + despesas + ICMS
  assert.ok(Math.abs(c.icms - base * p.icms) < 1e-9);
});

test("margem positiva abaixo do teto e negativa acima", () => {
  assert.ok(margem(42.13, 38) > 0.09);
  assert.ok(margem(42.13, 46) < 0);
});

test("leitura das alíquotas da TEC (vírgula, ponto e marca BIT/BK)", () => {
  assert.deepEqual(lerAliquota("12.6"), { valor: 0.126, marca: null });
  assert.deepEqual(lerAliquota("12,6BK"), { valor: 0.126, marca: "BK" });
  assert.deepEqual(lerAliquota("0BIT"), { valor: 0, marca: "BIT" });
  assert.equal(lerAliquota("").valor, null);
});
