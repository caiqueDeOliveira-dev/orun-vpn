/**
 * @orun/vpn-electron — windows-killswitch.ts
 *
 * ⚠️ POR QUE NÃO USAR PostUp/PreDown do WireGuard for Windows:
 * o serviço de túnel do Windows suporta PostUp/PreDown, mas só depois de
 * setar `HKLM\Software\WireGuard\DangerousScriptExecution = 1` — os scripts
 * rodam como usuário SYSTEM. A própria documentação oficial
 * (github.com/WireGuard/wireguard-windows/blob/master/docs/adminregistry.md)
 * avisa: "this execution is done as the Local System user... therefore a
 * real target of malware... enable only with the utmost trepidation".
 * Decisão: não pedir pro usuário abrir esse buraco de segurança só pra
 * habilitar o kill switch. Em vez disso, o próprio processo Electron (que já
 * roda elevado pra instalar o túnel) orquestra o Windows Firewall via
 * PowerShell diretamente, sem tocar nesse registro.
 *
 * ⚠️ POR QUE "Block All + Allow Specific" NÃO FUNCIONA NO WINDOWS:
 * ao contrário do nftables (Linux), o Windows Firewall tem uma precedência
 * FIXA e não-configurável: Block sempre vence Allow, não importa ordem ou
 * especificidade da regra (confirmado em
 * learn.microsoft.com/windows/security/operating-system-security/network-security/windows-firewall/rules).
 * Uma regra "Block All Outbound" mataria também as regras "Allow" que
 * deveriam liberar o túnel — silenciosamente, sem erro.
 *
 * A abordagem correta (usada aqui): mudar o `DefaultOutboundAction` do
 * perfil de rede pra `Block` (que tem a MENOR precedência) e usar só regras
 * explícitas de `Allow` pra abrir exceções. Como não existe nenhuma regra
 * de Block explícita competindo, as regras de Allow funcionam sem conflito.
 *
 * ⚠️ GAP NÃO VERIFICADO: não tenho uma máquina Windows neste ambiente pra
 * rodar isso de verdade. A lógica está fundamentada na documentação oficial
 * da Microsoft (citada acima), não em suposição — mas precisa de validação
 * real antes de confiar em produção. 2 assunções específicas ainda não
 * confirmadas:
 *  1. `-RemoteAddress` do New-NetFirewallRule espera IP, não hostname —
 *     mesmo problema do nftables (Linux) e pf (macOS): se `server.host` for
 *     um DDNS, precisa resolver o IP antes de montar o script.
 *  2. Assumo que o nome do adaptador de rede criado pelo
 *     `wireguard.exe /installtunnelservice` é igual ao nome do túnel
 *     (derivado do nome do arquivo .conf) — comportamento comum observado
 *     em relatos da comunidade, mas não confirmado contra uma instalação
 *     real neste ambiente.
 */

export interface FirewallProfileState {
  name: 'Domain' | 'Private' | 'Public';
  defaultOutboundAction: 'Allow' | 'Block' | 'NotConfigured';
}

const RULE_PREFIX = 'OrunVPN-KillSwitch';

/** PowerShell pra capturar o estado atual antes de mexer — necessário pra restaurar depois.
 *  Força DefaultOutboundAction a serializar como string (.ToString()) porque
 *  o comportamento padrão do ConvertTo-Json pra esse enum varia entre
 *  versões do PowerShell (às vezes serializa como nome, às vezes como
 *  número da CIM instance) — forçar string remove essa ambiguidade em vez
 *  de manter uma tabela de mapeamento numérico chutada. */
export function buildGetProfileStateScript(): string {
  return (
    'Get-NetFirewallProfile | ' +
    "Select-Object Name, @{Name='DefaultOutboundAction';Expression={$_.DefaultOutboundAction.ToString()}} | " +
    'ConvertTo-Json -Compress'
  );
}

/**
 * Habilita o kill switch: Default = Block nos 3 perfis, e Allow explícito só
 * pro adaptador do túnel e pro IP do servidor (necessário pro handshake
 * WireGuard em si, que não passa pela interface do túnel).
 *
 * ⚠️ GAP HONESTO: a própria doc da Microsoft sobre esse padrão avisa que,
 * em produção, "outbound allow rules for all network traffic that must be
 * permitted" precisam ser criadas — ex: DHCP renewal, resolução de nome
 * local. Esse conjunto mínimo de 3 regras cobre o objetivo central (vazar
 * tráfego fora do túnel), mas pode quebrar renovação de DHCP ou outras
 * funções de rede do próprio Windows enquanto o kill switch está ativo.
 * Não testado contra uma máquina Windows real.
 */
export function buildEnableKillSwitchScript(tunnelInterfaceAlias: string, serverIp: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block",
    `New-NetFirewallRule -DisplayName '${RULE_PREFIX}-AllowLoopback' -Direction Outbound -Action Allow -RemoteAddress LocalSubnet -Profile Any | Out-Null`,
    `New-NetFirewallRule -DisplayName '${RULE_PREFIX}-AllowTunnel' -Direction Outbound -Action Allow -InterfaceAlias '${tunnelInterfaceAlias}' -Profile Any | Out-Null`,
    `New-NetFirewallRule -DisplayName '${RULE_PREFIX}-AllowServer' -Direction Outbound -Action Allow -RemoteAddress ${serverIp} -Profile Any | Out-Null`,
  ].join('; ');
}

/**
 * Desfaz o kill switch: remove só as regras que a Orun criou (nunca mexe em
 * regras de terceiros) e restaura o DefaultOutboundAction original de cada
 * perfil — não assume que era "Allow", porque política de empresa/domínio
 * pode já ter configurado outra coisa antes da gente chegar.
 */
export function buildDisableKillSwitchScript(previousState: FirewallProfileState[]): string {
  const restoreCommands = previousState
    .filter((p) => p.defaultOutboundAction !== 'NotConfigured')
    .map((p) => `Set-NetFirewallProfile -Profile ${p.name} -DefaultOutboundAction ${p.defaultOutboundAction}`);

  return [
    "$ErrorActionPreference = 'Stop'",
    `Get-NetFirewallRule -DisplayName '${RULE_PREFIX}-*' | Remove-NetFirewallRule`,
    ...restoreCommands,
  ].join('; ');
}

export function parseProfileState(psJsonOutput: string): FirewallProfileState[] {
  const parsed = JSON.parse(psJsonOutput) as
    | { Name: string; DefaultOutboundAction: string }
    | { Name: string; DefaultOutboundAction: string }[];
  const list = Array.isArray(parsed) ? parsed : [parsed];

  return list.map((p) => ({
    name: p.Name as FirewallProfileState['name'],
    defaultOutboundAction: p.DefaultOutboundAction as FirewallProfileState['defaultOutboundAction'],
  }));
}
