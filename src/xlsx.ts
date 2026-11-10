import zlib from "node:zlib";

// Leitor mínimo de XLSX (só a primeira planilha, valores como texto), sem dependência externa.
// Suficiente para as planilhas oficiais (TEC e TIPI): várias abas, strings compartilhadas, inline e números.

type Entrada = { nome: string; metodo: number; tamanho: number; offsetLocal: number };

function entradasZip(buf: Buffer): Entrada[] {
  // End of Central Directory: assinatura 0x06054b50, nos últimos 64 KB do arquivo.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Arquivo não é um XLSX válido (zip sem diretório central).");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const saida: Entrada[] = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Diretório central do XLSX corrompido.");
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const cLen = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString("utf8", p + 46, p + 46 + nLen);
    saida.push({ nome, metodo, tamanho, offsetLocal });
    p += 46 + nLen + eLen + cLen;
  }
  return saida;
}

function lerEntrada(buf: Buffer, e: Entrada): string {
  const p = e.offsetLocal;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`Entrada ${e.nome} corrompida.`);
  const inicio = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const dados = buf.subarray(inicio, inicio + e.tamanho);
  if (e.metodo === 0) return dados.toString("utf8");
  if (e.metodo === 8) return zlib.inflateRawSync(dados).toString("utf8");
  throw new Error(`Compressão ${e.metodo} não suportada em ${e.nome}.`);
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTIDADES[e.toLowerCase()] ?? _;
  });
}

// Junta todos os <t> de um trecho (string rica tem vários).
function textos(xml: string): string {
  let s = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return decodificar(s);
}

function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function compartilhadasDe(buf: Buffer, porNome: Map<string, Entrada>): string[] {
  const out: string[] = [];
  const ss = porNome.get("xl/sharedStrings.xml");
  if (ss) for (const m of lerEntrada(buf, ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(textos(m[1]));
  return out;
}

function linhasDaPlanilha(xml: string, compartilhadas: string[]): string[][] {
  const linhas: string[][] = [];
  for (const mr of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const corpo = mr[1] ?? "";
    const linha: string[] = [];
    let pos = 0;
    for (const mc of corpo.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = mc[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? coluna(ref) : pos;
      const tipo = /\bt="(\w+)"/.exec(attrs)?.[1];
      const conteudo = mc[2] ?? "";
      let valor = "";
      if (tipo === "inlineStr") valor = textos(conteudo);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(conteudo)?.[1];
        if (v != null) valor = tipo === "s" ? compartilhadas[Number(v)] ?? "" : decodificar(v);
      }
      while (linha.length < idx) linha.push("");
      linha[idx] = valor;
      pos = idx + 1;
    }
    linhas.push(linha);
  }
  return linhas;
}

// Devolve as linhas da primeira planilha como matriz de textos (células vazias = "").
export function lerXlsx(buf: Buffer): string[][] {
  const entradas = entradasZip(buf);
  const porNome = new Map(entradas.map((e) => [e.nome, e]));
  const planilha =
    porNome.get("xl/worksheets/sheet1.xml") ??
    entradas.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.nome)).sort((a, b) => a.nome.localeCompare(b.nome))[0];
  if (!planilha) throw new Error("XLSX sem planilha.");
  return linhasDaPlanilha(lerEntrada(buf, planilha), compartilhadasDe(buf, porNome));
}

// Todas as abas, com o nome de cada uma (workbook.xml + rels). Útil para planilhas oficiais com anexos.
export function lerXlsxAbas(buf: Buffer): { nome: string; linhas: string[][] }[] {
  const entradas = entradasZip(buf);
  const porNome = new Map(entradas.map((e) => [e.nome, e]));
  const wb = porNome.get("xl/workbook.xml");
  const rels = porNome.get("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) return [{ nome: "Planilha1", linhas: lerXlsx(buf) }];
  const alvo = new Map<string, string>();
  for (const m of lerEntrada(buf, rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) alvo.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const compartilhadas = compartilhadasDe(buf, porNome);
  const abas: { nome: string; linhas: string[][] }[] = [];
  for (const m of lerEntrada(buf, wb).matchAll(/<sheet\b[^>]*>/g)) {
    const nome = decodificar(/\bname="([^"]+)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const e = rid ? porNome.get(alvo.get(rid) ?? "") : undefined;
    if (e) abas.push({ nome, linhas: linhasDaPlanilha(lerEntrada(buf, e), compartilhadas) });
  }
  return abas;
}
