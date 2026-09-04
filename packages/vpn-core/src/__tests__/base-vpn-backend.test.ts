import { describe, expect, it, vi } from 'vitest';
import { BaseVpnBackend } from '../base-vpn-backend';
import type { ISecretStoreLike } from '../interfaces';
import type { VpnPeer, VpnProfile, VpnServerConfig } from '../schema';

/** Backend fake em memória — não toca rede nem SO, só valida o fluxo da BaseVpnBackend. */
class FakeVpnBackend extends BaseVpnBackend {
  public connectCalls: string[] = [];
  public shouldFailConnect = false;

  protected async doConnect(
    _profile: VpnProfile,
    _peer: VpnPeer,
    _server: VpnServerConfig,
    privateKey: string,
  ): Promise<void> {
    this.connectCalls.push(privateKey);
    if (this.shouldFailConnect) throw new Error('falha simulada de conexão');
  }

  protected async doDisconnect(): Promise<void> {
    // no-op
  }
}

function makeSecretStore(value: string | null): ISecretStoreLike {
  return {
    get: vi.fn().mockResolvedValue(value),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

const profile: VpnProfile = {
  id: 'profile-1',
  serverId: '11111111-1111-1111-1111-111111111111',
  peerId: 'peer-1',
  privateKeySecretRef: 'vpn:profile-1:privatekey',
  autoConnect: false,
  killSwitch: true,
};

const peer: VpnPeer = {
  id: 'peer-1',
  serverId: '11111111-1111-1111-1111-111111111111',
  name: 'Caique-Desktop',
  publicKey: 'pub==',
  presharedKey: null,
  address: '10.8.0.2/32',
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
  dnsServer: '10.8.0.53',
  dnsFilter: { enabled: true, upstream: 'unbound-dot', blocklist: 'hagezi-pro' },
  createdAt: new Date().toISOString(),
};

describe('BaseVpnBackend', () => {
  it('estado inicial é disconnected', async () => {
    const backend = new FakeVpnBackend(makeSecretStore('privkey'));
    expect((await backend.getState()).status).toBe('disconnected');
  });

  it('connect() bem-sucedido busca a chave no secretStore e vai pra connected', async () => {
    const store = makeSecretStore('super-secret-privkey');
    const backend = new FakeVpnBackend(store);

    await backend.connect(profile, peer, server);
    const state = await backend.getState();

    expect(store.get).toHaveBeenCalledWith('vpn:profile-1:privatekey');
    expect(backend.connectCalls).toEqual(['super-secret-privkey']);
    expect(state.status).toBe('connected');
    expect(state.connectedSince).not.toBeNull();
  });

  it('connect() sem chave no secretStore falha com erro claro e vai pra error', async () => {
    const backend = new FakeVpnBackend(makeSecretStore(null));

    await expect(backend.connect(profile, peer, server)).rejects.toThrow(
      /Chave privada não encontrada/,
    );
    const state = await backend.getState();
    expect(state.status).toBe('error');
    expect(state.lastError).toMatch(/Chave privada não encontrada/);
  });

  it('doConnect que falha propaga o erro e marca status error', async () => {
    const backend = new FakeVpnBackend(makeSecretStore('privkey'));
    backend.shouldFailConnect = true;

    await expect(backend.connect(profile, peer, server)).rejects.toThrow('falha simulada');
    expect((await backend.getState()).status).toBe('error');
  });

  it('disconnect() volta pro estado disconnected e limpa profileId', async () => {
    const backend = new FakeVpnBackend(makeSecretStore('privkey'));
    await backend.connect(profile, peer, server);
    await backend.disconnect();

    const state = await backend.getState();
    expect(state.status).toBe('disconnected');
    expect(state.profileId).toBeNull();
    expect(state.connectedSince).toBeNull();
  });

  it('onStateChange notifica listeners a cada mudança e o unsubscribe funciona', async () => {
    const backend = new FakeVpnBackend(makeSecretStore('privkey'));
    const seen: string[] = [];
    const unsubscribe = backend.onStateChange((s) => seen.push(s.status));

    await backend.connect(profile, peer, server);
    unsubscribe();
    await backend.disconnect();

    expect(seen).toEqual(['connecting', 'connected']); // disconnect não aparece pq já desinscrevemos
  });

  it('setKillSwitch(true) na base lança (só subclasses implementam de verdade)', async () => {
    const backend = new FakeVpnBackend(makeSecretStore('privkey'));
    await expect(backend.setKillSwitch(true)).rejects.toThrow(/não implementado/);
  });
});
