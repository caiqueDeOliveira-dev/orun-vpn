#!/usr/bin/env node
/**
 * Orun VPN — exemplo de PROVISIONING de um dispositivo.
 *
 * Cria um peer no wg-easy, baixa a config .conf e o QR (SVG) para pastas
 * locais, e imprime a chave privada do peer (que o servidor gera) — só usar
 * em SETUP INICIAL confiável. Em produção, configure a chave privada no
 * ISecretStore local e use a config gerada pelo `getPeerConfig`.
 *
 * Requisitos:
 *   - `pnpm --filter @orun/vpn-core run build` (dist compilado)
 *   - Roda da raiz do workspace (`node packages/vpn-core/examples/provision-peer.cjs`)
 *
 * Uso (variáveis de ambiente, para não expor segredo em argv):
 *   ORUN_VPN_API_URL=http://127.0.0.1:51821   # base da API (ou https://vpn.orun.dev:51821)
 *   ORUN_VPN_PASSWORD=<senha admin do wg-easy>
 *   node packages/vpn-core/examples/provision-peer.cjs "Caique-iPhone" ./out
 */
const path = require('node:path');
const fs = require('node:fs/promises');
// Resolve o dist COMPILADO do próprio pacote (sem depender do symlink do
// workspace): `require('../dist')` usa packages/vpn-core/dist/index.js,
// que exporta o WgEasyClient. Rode `pnpm --filter @orun/vpn-core run build`
// antes se o dist não existir.
const { WgEasyClient } = require('../dist');

async function main() {
  const name = process.argv[2];
  const outDir = process.argv[3] ?? './out';
  if (!name) {
    console.error('Uso: node packages/vpn-core/examples/provision-peer.cjs "<nome-do-dispositivo>" [./out]');
    process.exit(1);
  }

  const baseUrl = process.env.ORUN_VPN_API_URL;
  const password = process.env.ORUN_VPN_PASSWORD;
  if (!baseUrl || !password) {
    console.error('Faltam ORUN_VPN_API_URL e/ou ORUN_VPN_PASSWORD (variáveis de ambiente).');
    process.exit(1);
  }

  // "orquestrar, não reinventar" — usa o client real validado contra a API v14.
  const client = new WgEasyClient({ baseUrl });
  await client.login('admin', password); // v14 ignora o username

  const peer = await client.createPeer(name, 'server-1');
  console.log(`Peer criado: id=${peer.id} name=${peer.name} addr=${peer.address}`);

  await fs.mkdir(outDir, { recursive: true });
  const safe = peer.name.replace(/[^a-zA-Z0-9_-]/g, '-');

  const config = await client.getPeerConfig(peer.id);
  await fs.writeFile(path.join(outDir, `${safe}.conf`), config);
  console.log(`Config salva: ${path.join(outDir, `${safe}.conf`)} (${config.length} bytes)`);

  const qr = await client.getPeerQrCodeSvg(peer.id);
  await fs.writeFile(path.join(outDir, `${safe}.svg`), qr);
  console.log(`QR salvo: ${path.join(outDir, `${safe}.svg`)}`);

  console.log('\nPróximo passo (no dispositivo): usar a .conf no app WireGuard, ou ler o QR.');
  console.log('NÃO commita a .conf (contém chave privada). Configure o ISecretStore no desktop.');
}

main().catch((err) => {
  console.error('Falhou:', err && err.message ? err.message : err);
  process.exit(1);
});
