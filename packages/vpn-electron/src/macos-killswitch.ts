/**
 * @orun/vpn-electron — macos-killswitch.ts
 *
 * ✅ Confirmado que wg-quick no macOS (via `brew install wireguard-tools`)
 * suporta PostUp/PreDown normalmente, igual Linux — inclusive substitui
 * `%i` pelo nome real da interface (utunN, escolhido dinamicamente pelo
 * kernel) antes de rodar o comando via `sh -c`. Fonte: exemplo real de
 * config com PostUp/PostDown pra fixar DNS no wg-quick macOS.
 *
 * Usa `pf` (Packet Filter) num anchor dedicado (`orun_vpn_killswitch`),
 * carregado via `pfctl -a <anchor> -f -` (lê regras do stdin, não precisa
 * editar /etc/pf.conf do sistema). Ordem das regras importa: `block drop
 * out all` primeiro, depois `pass out quick` — no pf, uma regra sem `quick`
 * só define o "último match vence"; regras com `quick` interrompem a
 * avaliação imediatamente quando batem, então elas efetivamente vencem o
 * block mesmo vindo depois dele no arquivo.
 *
 * ⚠️ GAP NÃO VERIFICADO: não tenho um Mac neste ambiente pra testar o
 * quoting do heredoc dentro de uma linha PostUp de verdade. A lógica do pf
 * em si é padrão (mesmo idioma usado por ferramentas como Little Snitch),
 * mas o encaixe exato do heredoc no PostUp do wg-quick precisa de validação
 * real antes de confiar em produção.
 */

const ANCHOR_NAME = 'orun_vpn_killswitch';

export function buildMacOsPostUpCommand(serverIp: string): string {
  const pfRules = ['block drop out all', 'pass out quick on %i', `pass out quick to ${serverIp}`].join('\\n');
  return `sh -c 'printf "${pfRules}\\n" | pfctl -a ${ANCHOR_NAME} -f - ; pfctl -e 2>/dev/null || true'`;
}

export function buildMacOsPreDownCommand(): string {
  return `pfctl -a ${ANCHOR_NAME} -F all`;
}
