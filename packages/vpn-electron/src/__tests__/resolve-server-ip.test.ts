import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveServerIp } from '../resolve-server-ip';

vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(),
}));

describe('resolveServerIp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna o próprio valor sem chamar DNS quando já é um IP literal', async () => {
    const { resolve4 } = await import('node:dns/promises');
    const result = await resolveServerIp('203.0.113.5');

    expect(result).toBe('203.0.113.5');
    expect(resolve4).not.toHaveBeenCalled();
  });

  it('resolve hostname/DDNS via DNS A record (regressão do gap hostname-vs-IP)', async () => {
    const { resolve4 } = await import('node:dns/promises');
    vi.mocked(resolve4).mockResolvedValueOnce(['198.51.100.10']);

    const result = await resolveServerIp('vpn.orun.dev');

    expect(resolve4).toHaveBeenCalledWith('vpn.orun.dev');
    expect(result).toBe('198.51.100.10');
  });

  it('usa o primeiro IP quando o DNS devolve múltiplos (round-robin)', async () => {
    const { resolve4 } = await import('node:dns/promises');
    vi.mocked(resolve4).mockResolvedValueOnce(['198.51.100.10', '198.51.100.11']);

    const result = await resolveServerIp('vpn.orun.dev');
    expect(result).toBe('198.51.100.10');
  });

  it('lança erro claro quando o DNS não retorna nenhum endereço', async () => {
    const { resolve4 } = await import('node:dns/promises');
    vi.mocked(resolve4).mockResolvedValueOnce([]);

    await expect(resolveServerIp('vpn-quebrado.orun.dev')).rejects.toThrow(/não retornou nenhum endereço/);
  });
});
