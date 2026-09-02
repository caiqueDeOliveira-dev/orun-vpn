import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @orun/vpn-electron — find-wireguard-exe.ts
 *
 * ⚠️ CORREÇÃO DE UMA SUPOSIÇÃO ERRADA: cheguei a pensar que existiria uma
 * chave de registro pro caminho de instalação (seguindo o padrão de
 * `DangerousScriptExecution`/`LimitedOperatorUI`, que são reais). Não
 * existe — conferido direto na doc oficial
 * (github.com/WireGuard/wireguard-windows/blob/master/docs/adminregistry.md),
 * que só documenta essas duas chaves, nenhuma de instalação.
 *
 * Em vez de continuar com um caminho fixo (`C:\Program Files\...`, que
 * quebra se o Windows estiver instalado num drive diferente, ou WireGuard
 * instalado manualmente noutro lugar), essa função tenta candidatos
 * baseados nas variáveis de ambiente reais do processo, e cai pra
 * `where.exe` (que busca no PATH) como último recurso.
 */
export function getWireGuardExeCandidatePaths(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  if (env.ProgramFiles) {
    candidates.push(`${env.ProgramFiles}\\WireGuard\\wireguard.exe`);
  }
  if (env['ProgramFiles(x86)']) {
    candidates.push(`${env['ProgramFiles(x86)']}\\WireGuard\\wireguard.exe`);
  }
  // Fallback caso as env vars não estejam setadas por algum motivo (raro,
  // mas mais honesto que assumir só C:\ sem checar nada).
  if (candidates.length === 0) {
    candidates.push('C:\\Program Files\\WireGuard\\wireguard.exe');
  }
  return candidates;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve o caminho real do wireguard.exe: tenta os candidatos baseados em
 * env vars, e se nenhum existir, tenta `where.exe wireguard.exe` (busca no
 * PATH). Lança erro claro em vez de deixar o `execFile` falhar depois com
 * um "ENOENT" genérico difícil de diagnosticar.
 */
export async function findWireGuardExe(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  for (const candidate of getWireGuardExeCandidatePaths(env)) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  try {
    const { stdout } = await execFileAsync('where.exe', ['wireguard.exe']);
    const firstMatch = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (firstMatch) return firstMatch.trim();
  } catch {
    // where.exe não achou nada no PATH — cai pro erro final abaixo.
  }

  throw new Error(
    'WireGuard for Windows não encontrado (nem em %ProgramFiles%, nem no PATH). ' +
      'Instale em https://www.wireguard.com/install/ ou informe o caminho manualmente.',
  );
}
