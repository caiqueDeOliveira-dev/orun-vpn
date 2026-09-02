import { describe, expect, it } from 'vitest';
import { buildWireGuardConfig } from '../build-wireguard-config';
import type { VpnPeer, VpnServerConfig } from '@orun/vpn-core';

const peer: VpnPeer = {
  id: 'peer-1',
  serverId: '11111111-1111-1111-1111-111111111111',
  name: 'Caique-Desktop',
  publicKey: 'peer-pub==',
  address: '10.8.0.7/32',
  enabled: true,
  createdAt: new Date().toISOString(),
  latestHandshakeAt: null,
  transferRx: 0,
  transferTx: 0,
};

const server: VpnServerConfig = {
  id: '11111111-1111-1111-1111-111111111111',
  label: 'Orun VPN - Teste',
  host: 'vpn.orun.dev',
  apiPort: 51821,
  wgPort: 51820,
  wgPublicKey: 'server-pub==',
  useTls: true,
  dnsFilter: { enabled: true, upstream: 'unbound-dot', blocklist: 'hagezi-pro' },
  createdAt: new Date().toISOString(),
};

describe('buildWireGuardConfig', () => {
  it('usa o endereço real do peer, não um valor fixo (regressão do bug 10.8.0.2 hardcoded)', () => {
    const config = buildWireGuardConfig('privkey', peer, server, false, 'darwin');
    expect(config).toContain('Address = 10.8.0.7/32');
    expect(config).not.toContain('10.8.0.2');
  });

  it('inclui a PublicKey do servidor no bloco [Peer] (regressão do bug do [Peer] sem chave)', () => {
    const config = buildWireGuardConfig('privkey', peer, server, false, 'darwin');
    expect(config).toContain('PublicKey = server-pub==');
    expect(config).toContain('Endpoint = vpn.orun.dev:51820');
  });

  it('omite DNS quando dnsFilter está desabilitado', () => {
    const serverSemDns: VpnServerConfig = {
      ...server,
      dnsFilter: { ...server.dnsFilter, enabled: false },
    };
    const config = buildWireGuardConfig('privkey', peer, serverSemDns, false, 'darwin');
    expect(config).not.toContain('DNS =');
  });

  it('adiciona regras nftables de kill switch só no Linux', () => {
    const linuxConfig = buildWireGuardConfig('privkey', peer, server, true, 'linux');
    expect(linuxConfig).toContain('PostUp = nft');
    expect(linuxConfig).toContain('PreDown = nft delete table inet orun_vpn_killswitch');

    const macConfig = buildWireGuardConfig('privkey', peer, server, true, 'darwin');
    expect(macConfig).not.toContain('nft');
  });

  it('adiciona regras pf de kill switch no macOS, não nftables', () => {
    const macConfig = buildWireGuardConfig('privkey', peer, server, true, 'darwin');
    expect(macConfig).toContain('PostUp = sh -c');
    expect(macConfig).toContain('pfctl -a orun_vpn_killswitch -f -');
    expect(macConfig).toContain('PreDown = pfctl -a orun_vpn_killswitch -F all');

    const linuxConfig = buildWireGuardConfig('privkey', peer, server, true, 'linux');
    expect(linuxConfig).not.toContain('pfctl');
  });

  it('não gera nenhum PostUp/PreDown de kill switch no Windows (tratado à parte via PowerShell)', () => {
    const winConfig = buildWireGuardConfig('privkey', peer, server, true, 'win32');
    expect(winConfig).not.toContain('PostUp');
    expect(winConfig).not.toContain('PreDown');
  });

  it('não injeta AllowedIPs vazio nem quebra em plataforma desconhecida', () => {
    const config = buildWireGuardConfig('privkey', peer, server, true, 'win32');
    expect(config).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(config).not.toContain('nft');
  });
});
