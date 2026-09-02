import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWireGuardExeCandidatePaths, findWireGuardExe } from '../find-wireguard-exe';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('getWireGuardExeCandidatePaths', () => {
  it('usa %ProgramFiles% e %ProgramFiles(x86)% do env em vez de C:\\ fixo', () => {
    const candidates = getWireGuardExeCandidatePaths({
      ProgramFiles: 'D:\\Program Files',
      'ProgramFiles(x86)': 'D:\\Program Files (x86)',
    });

    expect(candidates).toEqual([
      'D:\\Program Files\\WireGuard\\wireguard.exe',
      'D:\\Program Files (x86)\\WireGuard\\wireguard.exe',
    ]);
  });

  it('cai pro caminho C:\\ padrão só se as env vars realmente não existirem', () => {
    const candidates = getWireGuardExeCandidatePaths({});
    expect(candidates).toEqual(['C:\\Program Files\\WireGuard\\wireguard.exe']);
  });
});

describe('findWireGuardExe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna o primeiro candidato que existe de fato no disco', async () => {
    const { access } = await import('node:fs/promises');
    vi.mocked(access).mockResolvedValueOnce(undefined as never); // primeiro candidato "existe"

    const path = await findWireGuardExe({ ProgramFiles: 'C:\\Program Files' });
    expect(path).toBe('C:\\Program Files\\WireGuard\\wireguard.exe');
  });

  it('cai pro where.exe quando nenhum candidato existe em disco', async () => {
    const { access } = await import('node:fs/promises');
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: 'D:\\Custom\\WireGuard\\wireguard.exe\r\n', stderr: '' });
    }) as any);

    const path = await findWireGuardExe({ ProgramFiles: 'C:\\Program Files' });
    expect(path).toBe('D:\\Custom\\WireGuard\\wireguard.exe');
  });

  it('lança erro claro quando não acha em lugar nenhum (nem disco, nem PATH)', async () => {
    const { access } = await import('node:fs/promises');
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockImplementation(((_cmd: string, _args: string[], cb: any) => {
      cb(new Error('não achou no PATH'), { stdout: '', stderr: '' });
    }) as any);

    await expect(findWireGuardExe({ ProgramFiles: 'C:\\Program Files' })).rejects.toThrow(
      /não encontrado/,
    );
  });
});
