import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

// Download com cache local. O balanca.mdic.gov.br (Comex Stat) entrega a cadeia TLS sem o intermediário
// "AC SERPRO AR46 OV TLS CA 2025"; o Windows completa sozinho, Linux e macOS não. O intermediário
// (emitido pela GlobalSign Root R46) vai em certs/ e entra como CA ADICIONAL: a cadeia continua precisando
// fechar numa raiz confiável do Node.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DIR_CACHE = process.env.CUSTO_IMPORTACAO_CACHE ?? path.join(RAIZ, ".cache");
const INTERMEDIARIO = fs.readFileSync(path.join(RAIZ, "certs", "serpro-ar46-ov-tls-ca-2025.pem"), "utf8");
const AGENTE = new https.Agent({ ca: [...tls.rootCertificates, INTERMEDIARIO], keepAlive: true });
const UA = "Mozilla/5.0 (compatible; custo-importacao-br; +https://github.com/thiagogardev/custo-importacao-br)";

function obter(url: string, destino: string, redirecionamentos = 5): Promise<void> {
  return new Promise((ok, erro) => {
    const cliente = url.startsWith("https:") ? https : http;
    const req = cliente.get(url, { agent: url.startsWith("https:") ? AGENTE : undefined, headers: { "User-Agent": UA } }, (res) => {
      const st = res.statusCode ?? 0;
      if (st >= 300 && st < 400 && res.headers.location && redirecionamentos > 0) {
        res.resume();
        obter(new URL(res.headers.location, url).toString(), destino, redirecionamentos - 1).then(ok, erro);
        return;
      }
      if (st !== 200) {
        res.resume();
        erro(new Error(`HTTP ${st} em ${url}`));
        return;
      }
      const tmp = `${destino}.parcial`;
      const arq = fs.createWriteStream(tmp);
      res.pipe(arq);
      arq.on("finish", () => arq.close(() => fs.rename(tmp, destino, (e) => (e ? erro(e) : ok()))));
      arq.on("error", erro);
    });
    req.on("error", erro);
    req.setTimeout(300_000, () => req.destroy(new Error(`tempo esgotado em ${url}`)));
  });
}

// Baixa para o cache; reaproveita se o arquivo tiver menos de `validadeDias` dias.
export async function baixar(url: string, nome: string, validadeDias = 7): Promise<string> {
  fs.mkdirSync(DIR_CACHE, { recursive: true });
  const destino = path.join(DIR_CACHE, nome);
  try {
    const st = fs.statSync(destino);
    if (st.size > 0 && Date.now() - st.mtimeMs < validadeDias * 86400_000) return destino;
  } catch {
    // não existe
  }
  process.stderr.write(`  baixando ${url}\n`);
  await obter(url, destino);
  return destino;
}

export async function textoDe(url: string): Promise<string> {
  return new Promise((ok, erro) => {
    https
      .get(url, { agent: AGENTE, headers: { "User-Agent": UA } }, (res) => {
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (s += d));
        res.on("end", () => ok(s));
      })
      .on("error", erro);
  });
}
