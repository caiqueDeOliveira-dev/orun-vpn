import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WgEasyClient } from '../wg-easy-client';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('WgEasyClient (API real do wg-easy v14)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login() chama POST /api/session com password (sem username) e guarda a senha pro header Authorization', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: true },
        { headers: { 'Content-Type': 'application/json', 'set-cookie': 'connect.sid=sess123; Path=/' } },
      ),
    );

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://vpn.orun.dev:51821/api/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ password: 'senha-forte' }),
      }),
    );
  });

  it('login() lança erro claro quando o server responde HTTP 401 (credencial errada)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 401, headers: { 'Content-Type': 'application/json' } }));

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await expect(client.login('caique', 'errada')).rejects.toThrow(/HTTP 401/);
  });

  it('listPeers() usa /api/wireguard/client e mapeia address -> address (campo único)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'abcdef12',
            name: 'Caique-Desktop',
            address: '10.8.0.7',
            publicKey: 'server-side-pub==',
            enabled: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            latestHandshakeAt: null,
            transferRx: null,
            transferTx: null,
            downloadableConfig: true,
          },
        ]),
      );

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');
    const peers = await client.listPeers('server-1');

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://vpn.orun.dev:51821/api/wireguard/client',
      expect.anything(),
    );
    expect(peers).toEqual([
      {
        id: 'abcdef12',
        serverId: 'server-1',
        name: 'Caique-Desktop',
        publicKey: 'server-side-pub==',
        address: '10.8.0.7',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        latestHandshakeAt: null,
        transferRx: 0,
        transferTx: 0,
      },
    ]);
  });

  it('createPeer() usa POST /api/wireguard/client com { name } e busca o peer pelo nome (não devolve id)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 'old-peer', name: 'Outro' },
          { id: 'new-peer', name: 'Caique-Desktop', address: '10.8.0.8', publicKey: 'pub==', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' },
        ]),
      );

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');
    const peer = await client.createPeer('Caique-Desktop', 'server-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://vpn.orun.dev:51821/api/wireguard/client',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Caique-Desktop' }) }),
    );
    expect(peer.id).toBe('new-peer');
    expect(peer.name).toBe('Caique-Desktop');
  });

  it('deletePeer() usa DELETE /api/wireguard/client/:id', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');
    await client.deletePeer('abcdef12');

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://vpn.orun.dev:51821/api/wireguard/client/abcdef12',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('setPeerEnabled() usa /api/wireguard/client/:id/enable|disable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');
    await client.setPeerEnabled('abcdef12', false);
    await client.setPeerEnabled('abcdef12', true);

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain('https://vpn.orun.dev:51821/api/wireguard/client/abcdef12/disable');
    expect(urls).toContain('https://vpn.orun.dev:51821/api/wireguard/client/abcdef12/enable');
  });

  it('getPeerConfig() usa /api/wireguard/client/:id/configuration', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(new Response('[Interface]...', { status: 200, headers: { 'Content-Type': 'text/plain' } }));

    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await client.login('caique', 'senha-forte');
    const cfg = await client.getPeerConfig('abcdef12');

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://vpn.orun.dev:51821/api/wireguard/client/abcdef12/configuration',
      expect.anything(),
    );
    expect(cfg).toBe('[Interface]...');
  });

  it('métodos lançam erro claro se chamados antes de login()', async () => {
    const client = new WgEasyClient({ baseUrl: 'https://vpn.orun.dev:51821' });
    await expect(client.listPeers('server-1')).rejects.toThrow(/chame login\(\)/);
  });
});
