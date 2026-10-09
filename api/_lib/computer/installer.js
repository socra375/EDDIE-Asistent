// The one-click installer of EDDIE Prime for Windows: a single .cmd file that
// the hub's card generates for the signed-in owner, with a one-time pairing code
// already inside. Double-click it and it:
//   1. finds Python 3.8+ (or installs it with winget, per user, no admin),
//   2. puts the agent in %LOCALAPPDATA%\Eddie with its own virtual environment,
//   3. downloads eddie_agent.py from Eddie and pairs it with the account (the code),
//   4. makes it start by itself at every sign-in, hidden, in the background
//      (a scheduled task; the Startup folder if Windows refuses the task),
//   5. registers an uninstaller, so it shows in Settings → Apps like any other app.
// Nothing needs a terminal and nothing needs administrator rights. The file is
// plain text on purpose: the owner can open it and read exactly what it does.
//
// Layout: a few lines of cmd that pull the PowerShell part (after the marker) out of
// the file itself into a temp .ps1 and run it, so the PowerShell is a normal script
// and not an "iex" one-liner. The PowerShell has no backticks and no `${`, so it can
// sit in a template literal untouched.
const MARKER = '<#PS#>';
const DEFAULT_ORIGIN = 'https://eddie-asistent.vercel.app';

export const INSTALLER_FILENAME = 'Instalar-EDDIE-Prime.cmd';
export const INSTALLER_CODE_MINUTES = 30;

// Where the installer downloads the agent from: this deployment (APP_URL, or the page that asked),
// always https (plain http only for localhost, for development).
export function installerOrigin(headers = {}, env = process.env) {
  for (const raw of [env.APP_URL, headers.origin]) {
    try {
      const u = new URL(String(raw || ''));
      const local = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin;
    } catch {
      // try the next one
    }
  }
  return DEFAULT_ORIGIN;
}

const CMD_PART = [
  '@echo off',
  'chcp 65001 >nul',
  'title Instalar EDDIE Prime',
  'set "EDDIE_SELF=%~f0"',
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:EDDIE_SELF,[Text.Encoding]::UTF8);$m='<#'+'PS'+'#>';$p=Join-Path $env:TEMP 'eddie-setup.ps1';[IO.File]::WriteAllText($p,$t.Substring($t.IndexOf($m)+$m.Length),(New-Object Text.UTF8Encoding($true)))"`,
  'if not exist "%TEMP%\\eddie-setup.ps1" (',
  '  echo No se pudo preparar el instalador.',
  '  pause',
  '  exit /b 1',
  ')',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\\eddie-setup.ps1"',
  'del "%TEMP%\\eddie-setup.ps1" >nul 2>&1',
  'exit /b',
  MARKER,
].join('\n');

const POWERSHELL_PART = String.raw`
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$AppUrl = '__APP__'
$Code = '__CODE__'
$Dir = Join-Path $env:LOCALAPPDATA 'Eddie'
$TaskName = 'EDDIE Prime'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EddiePrime'
$StartupFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'EDDIE Prime.vbs'
$LogFile = Join-Path (Join-Path $env:APPDATA 'eddie-agent') 'agent.log'

function Say([string]$Text) { Write-Host ('  ' + $Text) }
function Step([string]$Text) { Write-Host ''; Write-Host ('  ' + $Text) -ForegroundColor Cyan }
function Fail([string]$Text) {
  Write-Host ''
  Write-Host ('  No se pudo terminar: ' + $Text) -ForegroundColor Red
  Write-Host ''
  Read-Host '  Pulsa Enter para cerrar'
  exit 1
}

Write-Host ''
Write-Host '  ================================================' -ForegroundColor Cyan
Write-Host '   EDDIE Prime - instalador para Windows' -ForegroundColor Cyan
Write-Host '  ================================================' -ForegroundColor Cyan
Write-Host '  Deja que Eddie use este PC (abrir apps, ver el estado del equipo...).'
Write-Host '  Se instala solo para tu usuario, sin permisos de administrador,'
Write-Host '  y arranca solo cada vez que inicias sesion.'

function Find-Python {
  $candidates = @()
  $candidates += ,@('py', '-3')
  $candidates += ,@('python')
  $candidates += ,@('python3')
  foreach ($found in (Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe') -ErrorAction SilentlyContinue)) { $candidates += ,@($found.FullName) }
  foreach ($c in $candidates) {
    try {
      $exe = $c[0]
      $cmd = Get-Command $exe -ErrorAction SilentlyContinue
      if (-not $cmd) { continue }
      # The "python" that Windows ships to open the Microsoft Store is not Python.
      if ($cmd.Source -like '*\WindowsApps\python*') { continue }
      $extra = @()
      if ($c.Count -gt 1) { $extra = $c[1..($c.Count - 1)] }
      $out = & $exe @extra -c 'import sys; print(sys.executable); print(sys.version_info[0] * 100 + sys.version_info[1])' 2>$null
      $lines = @($out)
      if ($lines.Count -ge 2 -and [int]$lines[1] -ge 308 -and (Test-Path $lines[0])) { return $lines[0] }
    } catch { }
  }
  return $null
}

Step '1/5  Buscando Python'
$py = Find-Python
if (-not $py) {
  Say 'No encontre Python. Lo instalo con winget (oficial y gratuito)...'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail 'No tienes Python ni winget. Instala Python 3.12 desde https://www.python.org/downloads/ y abre este instalador otra vez.' }
  & winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  $py = Find-Python
  if (-not $py) { Fail 'Instale Python pero no pude encontrarlo. Cierra esta ventana y abre el instalador otra vez.' }
}
Say ('Python: ' + $py)

Step '2/5  Preparando la carpeta de Eddie'
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*eddie_agent.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$venv = Join-Path $Dir 'venv'
$vpy = Join-Path $venv 'Scripts\python.exe'
$vpyw = Join-Path $venv 'Scripts\pythonw.exe'
if (-not (Test-Path $vpyw)) {
  & $py -m venv $venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $vpyw)) { Fail 'No pude crear el entorno de Python.' }
}
& $vpy -m pip install --disable-pip-version-check --quiet --upgrade psutil
if ($LASTEXITCODE -ne 0) { Fail 'No pude instalar psutil (necesita internet).' }

Step '3/5  Descargando el agente de Eddie'
$agent = Join-Path $Dir 'eddie_agent.py'
try { Invoke-WebRequest -UseBasicParsing -Uri ($AppUrl + '/eddie_agent.py') -OutFile $agent } catch { Fail ('No pude descargar el agente desde ' + $AppUrl + ' (' + $_.Exception.Message + ').') }
$head = (Get-Content -Path $agent -TotalCount 3 -Encoding UTF8) -join ' '
if ($head -notmatch 'EDDIE Prime') { Fail 'El archivo descargado no parece el agente de Eddie.' }
& $vpy -m py_compile $agent
if ($LASTEXITCODE -ne 0) { Fail 'El agente descargado esta danado. Prueba otra vez.' }

Step '4/5  Vinculando este PC con tu cuenta de Eddie'
$env:EDDIE_INSTALLER = '1'
& $vpy $agent pair $Code --app $AppUrl --name $env:COMPUTERNAME
if ($LASTEXITCODE -ne 0) { Fail 'No se pudo vincular. Descarga el instalador otra vez desde Eddie (el codigo dura 30 minutos y sirve una sola vez).' }

Step '5/5  Dejandolo en marcha (arranca solo al iniciar sesion)'
Remove-Item $LogFile -Force -ErrorAction SilentlyContinue
$registered = $false
try {
  $action = New-ScheduledTaskAction -Execute $vpyw -Argument ('"' + $agent + '" run') -WorkingDirectory $Dir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN + '\' + $env:USERNAME)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'EDDIE Prime: deja que Eddie use este equipo.' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  $registered = $true
  if (Test-Path $StartupFile) { Remove-Item $StartupFile -Force -ErrorAction SilentlyContinue }
} catch {
  Say 'Windows no me dejo crear la tarea programada; uso la carpeta de Inicio.'
}
if (-not $registered) {
  $vbs = 'CreateObject("WScript.Shell").Run """' + $vpyw + '"" ""' + $agent + '"" run", 0, False'
  Set-Content -Path $StartupFile -Value $vbs -Encoding Unicode
  Start-Process -FilePath $vpyw -ArgumentList ('"' + $agent + '" run') -WindowStyle Hidden
}

# An uninstaller, listed in Settings > Apps like any other program.
$uninstall = Join-Path $Dir 'Desinstalar-EDDIE-Prime.ps1'
$uninstallText = @'
$ErrorActionPreference = 'SilentlyContinue'
$Dir = Join-Path $env:LOCALAPPDATA 'Eddie'
Write-Host ''
Write-Host '  Quitando EDDIE Prime de este PC...'
Stop-ScheduledTask -TaskName 'EDDIE Prime'
Unregister-ScheduledTask -TaskName 'EDDIE Prime' -Confirm:$false
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*eddie_agent.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'EDDIE Prime.vbs') -Force
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EddiePrime' -Recurse -Force
Remove-Item (Join-Path $env:APPDATA 'eddie-agent') -Recurse -Force
Start-Sleep -Seconds 1
Remove-Item $Dir -Recurse -Force
Write-Host ''
Write-Host '  Listo: EDDIE Prime ya no esta en este PC.'
Write-Host '  Para terminar, entra en Eddie > Conectores > Tu equipo y pulsa Desvincular.'
Write-Host ''
Read-Host '  Pulsa Enter para cerrar'
'@
Set-Content -Path $uninstall -Value $uninstallText -Encoding UTF8
try {
  New-Item -Path $UninstallKey -Force | Out-Null
  Set-ItemProperty -Path $UninstallKey -Name 'DisplayName' -Value 'EDDIE Prime'
  Set-ItemProperty -Path $UninstallKey -Name 'DisplayVersion' -Value '1.2.0'
  Set-ItemProperty -Path $UninstallKey -Name 'Publisher' -Value 'Eddie'
  Set-ItemProperty -Path $UninstallKey -Name 'InstallLocation' -Value $Dir
  Set-ItemProperty -Path $UninstallKey -Name 'UninstallString' -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $uninstall + '"')
  Set-ItemProperty -Path $UninstallKey -Name 'NoModify' -Value 1 -Type DWord
  Set-ItemProperty -Path $UninstallKey -Name 'NoRepair' -Value 1 -Type DWord
} catch { }

Say 'Comprobando que el agente esta en marcha...'
$ready = $false
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 1
  if ((Test-Path $LogFile) -and ((Get-Content -Path $LogFile -Raw -ErrorAction SilentlyContinue) -match 'listo como')) { $ready = $true; break }
}
Write-Host ''
if ($ready) {
  Write-Host '  Listo. EDDIE Prime esta instalado y conectado.' -ForegroundColor Green
  Write-Host '  Vuelve a Eddie y pulsa "Probar desde la nube". Arranca solo al iniciar sesion.'
} else {
  Write-Host '  Se instalo, pero todavia no veo que el agente haya contactado con Eddie.' -ForegroundColor Yellow
  Write-Host ('  Revisa el registro: ' + $LogFile)
}
Write-Host '  Para quitarlo: Configuracion de Windows > Aplicaciones > EDDIE Prime.'
Write-Host ''
Read-Host '  Pulsa Enter para cerrar'
`;

// The installer file's text, with Windows line endings. `code` is the one-time pairing
// code (8 letters/digits); `origin` the https address of this Eddie.
export function windowsInstaller({ code, origin }) {
  if (!/^[A-Z2-9]{8}$/.test(String(code))) throw new Error('Código de vinculación no válido.');
  const safeOrigin = new URL(origin).origin;
  const ps = POWERSHELL_PART.replace('__APP__', safeOrigin).replace('__CODE__', code);
  return `${CMD_PART}\n${ps}`.replace(/\r?\n/g, '\r\n');
}
