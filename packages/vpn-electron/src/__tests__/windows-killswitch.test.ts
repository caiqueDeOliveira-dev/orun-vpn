import { describe, expect, it } from 'vitest';
import {
  buildDisableKillSwitchScript,
  buildEnableKillSwitchScript,
  buildGetProfileStateScript,
  parseProfileState,
} from '../windows-killswitch';

describe('windows-killswitch', () => {
  it('buildGetProfileStateScript força serialização como string, não número', () => {
    const script = buildGetProfileStateScript();
    expect(script).toContain('.ToString()');
    expect(script).toContain('Get-NetFirewallProfile');
  });

  it('buildEnableKillSwitchScript usa Set-NetFirewallProfile (Default=Block), não Block-All-Outbound', () => {
    const script = buildEnableKillSwitchScript('orun-vpn', '203.0.113.5');

    // Regressão do bug de precedência: NÃO pode criar uma regra explícita
    // de Block, porque ela venceria qualquer Allow no Windows Firewall.
    expect(script).not.toMatch(/-Action Block/);
    expect(script).toContain('Set-NetFirewallProfile');
    expect(script).toContain('DefaultOutboundAction Block');
    expect(script).toContain("-InterfaceAlias 'orun-vpn'");
    expect(script).toContain('-RemoteAddress 203.0.113.5');
  });

  it('buildDisableKillSwitchScript restaura só perfis com estado conhecido e nunca mexe em regras de terceiros', () => {
    const script = buildDisableKillSwitchScript([
      { name: 'Domain', defaultOutboundAction: 'Allow' },
      { name: 'Private', defaultOutboundAction: 'Allow' },
      { name: 'Public', defaultOutboundAction: 'NotConfigured' },
    ]);

    expect(script).toContain("Get-NetFirewallRule -DisplayName 'OrunVPN-KillSwitch-*'");
    expect(script).toContain('Set-NetFirewallProfile -Profile Domain -DefaultOutboundAction Allow');
    expect(script).toContain('Set-NetFirewallProfile -Profile Private -DefaultOutboundAction Allow');
    // Public estava NotConfigured — não deve gerar comando de restore pra ele.
    expect(script).not.toContain('Set-NetFirewallProfile -Profile Public');
  });

  it('parseProfileState lê o JSON forçado como string sem depender de mapeamento numérico', () => {
    const json = JSON.stringify([
      { Name: 'Domain', DefaultOutboundAction: 'Allow' },
      { Name: 'Private', DefaultOutboundAction: 'Block' },
    ]);
    expect(parseProfileState(json)).toEqual([
      { name: 'Domain', defaultOutboundAction: 'Allow' },
      { name: 'Private', defaultOutboundAction: 'Block' },
    ]);
  });

  it('parseProfileState aceita objeto único (quando só 1 perfil ativo) sem quebrar', () => {
    const json = JSON.stringify({ Name: 'Public', DefaultOutboundAction: 'Allow' });
    expect(parseProfileState(json)).toEqual([{ name: 'Public', defaultOutboundAction: 'Allow' }]);
  });
});
