import { execFileSync } from 'child_process';
import { nativePurposeClassifierSource } from '../../renderer/e2e/helpers/nativeAppProcess';

const windowsTest = process.platform === 'win32' ? test : test.skip;
windowsTest('OS observer exports only allowlisted purpose labels, including encoded PTY helpers', () => {
  const identity = '$taskProcess = Get-CimInstance Win32_Process -Filter ProcessId=123';
  const commands = [
    'powershell -Command New-Object -ComObject Outlook.Application secret-calendar-value',
    'powershell -Command Get-CimInstance Win32_VideoController secret-profile-value',
    identity,
    'powershell -EncodedCommand ' + Buffer.from(identity, 'utf16le').toString('base64'),
    'powershell -Command Add-Type class OwnedPtyStop secret-stop-value',
    'powershell -Command Write-Output secret-unclassified-value',
    'powershell -EncodedCommand malformed-value',
  ];
  const values = Buffer.from(JSON.stringify(commands), 'utf8').toString('base64');
  const source = `$ErrorActionPreference='Stop';${nativePurposeClassifierSource()};$commands=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${values}')));$labels=@($commands|ForEach-Object{Get-CapturedPurpose $_});ConvertTo-Json -InputObject $labels -Compress`;
  // This pure metadata transform includes native shell startup. Its bounded
  // fixture budget is separate from the product's identity/Stop/quit deadlines.
  const stdout = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8', env: process.env, windowsHide: true, timeout: 15_000, maxBuffer: 4096 });
  expect(JSON.parse(stdout.trim())).toEqual(['outlook-com', 'gpu-discovery', 'pty-identity', 'pty-identity', 'pty-stop', 'unclassified', 'unclassified']);
  expect(stdout).not.toContain('secret-');
  expect(stdout).not.toContain('ProcessId');
}, 20_000);
