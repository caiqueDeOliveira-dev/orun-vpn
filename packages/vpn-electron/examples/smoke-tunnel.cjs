/*
 * @orun/vpn-electron — examples/smoke-tunnel.cjs
 *
 * Smoke test real do ElectronVpnBackend: sobe e derruba um túnel WireGuard
 * de verdade no SO host (Windows: wireguard.exe /installtunnelservice),
 * usando um peer provisionado no servidor via WgEasyClient.
 *
 * Por que existe: o backend foi escrito com base em código/documentação
 * oficial (Linux/macOS wg-quick, Windows wireguard.exe) mas NUNCA tinha sido
 * validado contra um SO real. Rodar de verdade pegou 2 bugs que os testes
 * unitários não pegavam (PresharedKey ausente no [Peer] -> handshake falha,
 * e DNS hardcoded pro gateway 10.8.0.1 em vez do Unbound 10.8.0.53).
 *
 * Uso (o connect exige admin — UAC):
 *   node examples/smoke-tunnel.cjs connect <peer-info.json>
 *   node examples/smoke-tunnel.cjs disconnect <peer-info.json>
 *
 * <peer-info.json> vem de um provisioning no servidor (ver
 * packages/vpn-core/examples/provision-peer.cjs): precisa de
 * { address, privateKey, presharedKey, serverPublicKey, wgPort, serverHost }.
 * Use host = IP da LAN onde o Docker publica 51820/udp (não vpn.orun.dev:
 * esse hostname precisa estar em DNS antes de virar o Endpoint real).
 */

const path = require('node:path');
const fs = require('node:fs');

async function main() {
  const [cmd, keyFile] = process.argv.slice(2);
  if (!cmd || !['connect', 'disconnect'].includes(cmd)) {
    throw new Error('uso: node smoke-tunnel.cjs <connect|disconnect> <peer-info.json>');
  }
  if (!keyFile) throw new Error('faltou o caminho do peer-info.json');

  const raw = fs.readFileSync(keyFile, 'utf8');
  const info = JSON.parse(raw.replace(/^\uFEFF/, '')); // tolera BOM UTF-8 (JSON.parse falha nele)
  const runFrom = path.join(__dirname, '..'); // packages/vpn-electron

  // Resolve os pacotes compilados via workspace (node precisa rodar daqui)
  const core = require(path.join(runFrom, 'node_modules', '@orun', 'vpn-core'));
  const vpnElectron = require(path.join(runFrom, 'dist', 'index.js'));

  const server = core.VpnServerConfigSchema.parse({
    id: '11111111-1111-1111-1111-111111111111',
    label: 'Orun VPN - Smoke',
    host: info.serverHost,
    apiPort: 51821,
    wgPort: info.wgPort,
    wgPublicKey: info.serverPublicKey,
    useTls: false,
    dnsServer: info.dns || '10.8.0.53',
    createdAt: new Date().toISOString(),
  });

  const peer = core.VpnPeerSchema.parse({
    id: info.peerId,
    serverId: server.id,
    name: info.name,
    publicKey: info.publicKey,
    presharedKey: info.presharedKey,
    address: info.address,
    enabled: true,
    createdAt: new Date().toISOString(),
    latestHandshakeAt: null,
    transferRx: 0,
    transferTx: 0,
  });

  const profile = core.VpnProfileSchema.parse({
    id: 'smoke-profile',
    serverId: server.id,
    peerId: peer.id,
    privateKeySecretRef: 'vpn:smoke:privatekey',
    autoConnect: false,
    killSwitch: false,
  });

  // Secret store fake: a chave privada REAL veio do servidor (provisioning) e
  // num fluxo de produção iria pro ISecretStore de verdade (ex: @orun/identity).
  const secretStore = {
    get: async () => info.privateKey,
    set: async () => {},
    delete: async () => {},
  };

  const backend = new vpnElectron.ElectronVpnBackend(secretStore);

  if (cmd === 'connect') {
    console.log('INSTALL_TUNNEL serviceName=orun-vpn');
    await backend.connect(profile, peer, server);
    console.log('TUNNEL_UP state=' + JSON.stringify(await backend.getState()));
  } else {
    await backend.disconnect();
    console.log('TUNNEL_DOWN dev=orun-vpn');
  }
}

main().catch((err) => {
  console.error('SMOKE_ERROR ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});