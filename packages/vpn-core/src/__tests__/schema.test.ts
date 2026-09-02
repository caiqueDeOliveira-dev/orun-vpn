import { describe, expect, it } from 'vitest';
import { VpnPeerSchema, VpnServerConfigSchema } from '../schema';

describe('VpnServerConfigSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    label: 'Orun VPN - Hetzner FSN1',
    host: 'vpn.orun.dev',
    wgPublicKey: 'abc123==',
    createdAt: new Date().toISOString(),
  };

  it('aplica defaults de porta e dnsFilter quando omitidos', () => {
    const parsed = VpnServerConfigSchema.parse(base);
    expect(parsed.apiPort).toBe(51821);
    expect(parsed.wgPort).toBe(51820);
    expect(parsed.dnsFilter.enabled).toBe(true);
    expect(parsed.dnsFilter.blocklist).toBe('hagezi-pro');
  });

  it('rejeita config sem wgPublicKey (regressão do bug do [Peer] vazio)', () => {
    const { wgPublicKey, ...withoutKey } = base;
    expect(() => VpnServerConfigSchema.parse(withoutKey)).toThrow();
  });

  it('rejeita id que não é uuid', () => {
    expect(() => VpnServerConfigSchema.parse({ ...base, id: 'not-a-uuid' })).toThrow();
  });
});

describe('VpnPeerSchema', () => {
  it('aceita um peer válido com serverId preenchido (regressão do bug do serverId vazio)', () => {
    const peer = {
      id: 'peer-1',
      serverId: '11111111-1111-1111-1111-111111111111',
      name: 'Caique-Desktop',
      publicKey: 'xyz==',
      address: '10.8.0.2/32',
      createdAt: new Date().toISOString(),
    };
    const parsed = VpnPeerSchema.parse(peer);
    expect(parsed.serverId).toBe('11111111-1111-1111-1111-111111111111');
    expect(parsed.enabled).toBe(true); // default
    expect(parsed.latestHandshakeAt).toBeNull(); // default
  });
});
