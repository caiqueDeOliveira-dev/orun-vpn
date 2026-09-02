import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WgEasyClient } from '../wg-easy-client';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('WgEasyClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login() chama POST /api/auth/password com username+password e guarda o cookie', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { status: 'success' },
        { headers: { 'Content-Type': 'application/json', 'set-cookie': 'wg-easy=abc123; Path=/; HttpOnly' } },
      ),
    );

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://vpn.orun.dev:51821/api/auth/password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'caique', password: 'senha-forte', remember: true }),
      }),
    );
  });

  it('login() lança erro claro quando wg-easy exige TOTP (2FA ainda não suportado)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'TOTP_REQUIRED' }));

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await expect(client.login('caique', 'senha-forte')).rejects.toThrow(/TOTP/);
  });

  it('listPeers() usa /api/client (não /api/wireguard/client) e mapeia ipv4Address -> address', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ status: 'success' }, { headers: { 'Content-Type': 'application/json', 'set-cookie': 'wg-easy=abc123' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 7,
            name: 'Caique-Desktop',
            ipv4Address: '10.8.0.7',
            ipv6Address: 'fd00::7',
            publicKey: 'pub==',
            enabled: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            latestHandshakeAt: null,
            transferRx: null,
            transferTx: null,
          },
        ]),
      );

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');
    const peers = await client.listPeers('server-1');

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://vpn.orun.dev:51821/api/client',
      expect.anything(),
    );
    expect(peers).toEqual([
      {
        id: '7', // number do wg-easy convertido pra string, domínio Orun fica estável
        serverId: 'server-1',
        name: 'Caique-Desktop',
        publicKey: 'pub==',
        address: '10.8.0.7',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        latestHandshakeAt: null,
        transferRx: 0,
        transferTx: 0,
      },
    ]);
  });

  it('métodos lançam erro claro se chamados antes de login()', async () => {
    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await expect(client.listPeers('server-1')).rejects.toThrow(/chame login\(\)/);
  });
});
