# custo-importacao-br

[![testes](https://github.com/thiagogardev/custo-importacao-br/actions/workflows/testes.yml/badge.svg)](https://github.com/thiagogardev/custo-importacao-br/actions/workflows/testes.yml)

**Quanto custa importar 1 kg de qualquer NCM, e a partir de que preço comprar no Brasil sai mais barato.**
Só com dados abertos e oficiais: Comex Stat (MDIC), TEC com os anexos da Resolução Gecex nº 272/2021
(MDIC/Camex), TIPI (Receita Federal) e PTAX (Banco Central).

```text
$ npm run ncm -- 40093100 --preco-kg 38

4009.31.00  Tubos de borracha vulcanizada não endurecida, reforçados apenas com matérias têxteis ... sem acessórios
Período 2025-11 a 2026-10 · PTAX 5.5146 (2026-11-09)
Mercado: US$ 60.6 mi em 12 de 12 meses (+4% sobre os 12 anteriores)
Origem: China 29%, Estados Unidos 16%, Índia 6%
Alíquotas: II 12,6% (Anexo II (aplicada)) · IPI 6,5%

Custo de importar 1 kg a US$ 7.65 (média nacional do NCM):
  CIF (frete 5,79%, seguro 0,075%)                 R$ 44,66
  II 12,6%                                          R$ 5,63
  AFRMM 8% do frete marítimo (89% marítimo)         R$ 0,17
  Despesas aduaneiras 3,0%                          R$ 1,34
  = Custo líquido (sem os recuperáveis)            R$ 51,80
  + IPI, PIS, Cofins e ICMS 18% (recuperáveis)     R$ 21,76
  = Desembolso                                     R$ 73,55

Teto de preço nacional: R$ 69,61/kg na nota (ICMS 18%, crédito PIS/Cofins 9,25%)
Margem do seu preço de R$ 38,00/kg: +45% (abaixo do custo de importar)
```

## Para quem é

Fabricante nacional ou distribuidor que concorre com produto importado. A ferramenta responde duas perguntas
para qualquer código NCM:

1. **Quanto custa, de fato, importar.** Não é o FOB, é o custo que fica com o importador: CIF, Imposto de
   Importação, AFRMM e despesas aduaneiras. IPI, PIS, Cofins e ICMS da importação aparecem à parte, porque quem
   está no regime normal recupera esses tributos como crédito.
2. **Qual o teto do preço nacional.** É o preço por kg na nota, com ICMS e sem IPI, que deixa o comprador com o
   mesmo custo líquido de importar. Abaixo dele, comprar no Brasil sai mais barato.

## Uso

Requer Node 20 ou mais novo.

```bash
npm install
npm run ncm -- 40093100                     # um NCM, com a conta aberta
npm run ncm -- 40093100 --preco-kg 38       # e a margem de um preço nacional (R$/kg na nota)
npm run ncm -- 40093100 --fob-kg 4.63       # com o FOB por kg do seu produto, em vez da média do NCM
npm run todos -- --saida ncms.csv           # todos os NCMs importados nos últimos 12 meses
npm test
```

Premissas, em porcentagem: `--icms 18` (ICMS da importação), `--despesas 3` (despachante, armazenagem e
Siscomex sobre o CIF), `--icms-venda 18` (ICMS da venda nacional) e `--pis-cofins 9.25` (crédito do comprador no
lucro real). Variáveis de ambiente opcionais: `CAMBIO` fixa o câmbio, `TEC_URL` indica a planilha da TEC e
`CUSTO_IMPORTACAO_CACHE` muda a pasta de cache.

O primeiro uso baixa cerca de 500 MB do Comex Stat, com três anos, para `.cache/`. O arquivo do ano corrente é
renovado a cada 7 dias.

## Como as contas são feitas

```text
CIF            = (FOB + frete + seguro) × PTAX
II             = CIF × alíquota do II
IPI            = (CIF + II) × alíquota do IPI
PIS / Cofins   = CIF × 2,10% / 9,65%
AFRMM          = frete × PTAX × fatia marítima × 8%
despesas       = CIF × 3%
ICMS           = (CIF + II + IPI + PIS + Cofins + AFRMM + despesas) / (1 − ICMS) × ICMS   (por dentro)

custo líquido  = CIF + II + AFRMM + despesas
desembolso     = custo líquido + IPI + PIS + Cofins + ICMS
teto nacional  = custo líquido / ((1 − ICMS da venda) × (1 − crédito de PIS/Cofins))
```

- **Mercado, preço, frete, seguro e via:** os 12 meses mais recentes publicados no Comex Stat, base bruta
  `IMP_<ano>.csv`, e os 12 anteriores para o crescimento. O preço é FOB / kg do NCM inteiro e, quando a unidade
  estatística não é kg, também FOB por unidade.
- **II:** Anexo II (alíquota brasileira aplicada) ou, sem ele, Anexo I (TEC). As exceções temporárias dos
  Anexos IV, V, VI, VIII, IX e X prevalecem quando valem para o NCM inteiro, sem Ex e sem quota, e estão vigentes.
  As que dependem de Ex ou de quota aparecem como aviso. O link da planilha vigente é lido da página
  "Tarifas Vigentes" do MDIC.
- **IPI:** linha da TIPI sem Ex. "NT" é não tributado.

## Limites

- **A média do NCM mistura produtos.** No 4009.31.00 a média é US$ 7,65/kg porque inclui mangueira montada de
  montadora. Mangueira a granel sai perto de US$ 4,63/kg, com teto de R$ 42,13/kg. Para um produto específico,
  use `--fob-kg`.
- O ICMS é um só para todos. Benefícios estaduais, como TTD em SC e Fundap no ES, mudam o desembolso, mas não o
  custo líquido.
- Não inclui o custo financeiro do prazo de importação nem o estoque de segurança. Os dois pesam a favor do
  fornecedor nacional.
- Não é consultoria tributária. Confira as alíquotas na TEC e na TIPI vigentes antes de decidir.

## Nota técnica: o certificado do Comex Stat

O `balanca.mdic.gov.br` entrega a cadeia TLS sem o certificado intermediário "AC SERPRO AR46 OV TLS CA 2025".
O Windows completa sozinho, mas Linux e macOS recusam a conexão (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). O
intermediário, emitido pela GlobalSign Root R46 e válido até 2030, está em `certs/` e entra como autoridade
adicional só nos downloads desta ferramenta. A verificação continua ligada: a cadeia precisa fechar numa raiz
confiável.

## Origem

Extraído da camada automática do Genesis, o sistema comercial que desenvolvo para a TT Imports e a Acoplin. Lá,
estas contas alimentam um ranking de oportunidades por NCM e a análise de mercado por importador. Case em
[garofalodeveloper.com](https://garofalodeveloper.com/cases/inteligencia-importacao). Repositório irmão:
[icms-st-dados](https://github.com/thiagogardev/icms-st-dados).

---

**English summary.** Command-line tool that computes, for any Brazilian NCM tariff code, the landed cost of
importing 1 kg (CIF + import duty + AFRMM + customs fees, excluding recoverable taxes) and the domestic price
ceiling below which buying in Brazil is cheaper than importing. It uses only official open data: Comex Stat
(trade statistics), the Mercosur Common External Tariff with Brazil's exceptions (Gecex Resolution 272/2021),
the IPI table (TIPI) and the Central Bank PTAX exchange rate. MIT license.
