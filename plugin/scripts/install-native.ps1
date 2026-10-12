param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [string]$DataRoot=(Join-Path $env:LOCALAPPDATA 'boss-job-search')
)
$ErrorActionPreference='Stop'
$taskPluginRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskRuntime=(Get-Command node -ErrorAction Stop).Source
if([int]((& $taskRuntime --version).TrimStart('v').Split('.')[0]) -lt 24){throw 'Node.js 24 or newer is required.'}
$taskDirectory=Join-Path ([IO.Path]::GetFullPath($DataRoot)) 'bridge'
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskConfigPath=Join-Path $taskDirectory 'config.json'
$taskConfig=$null
if(Test-Path -LiteralPath $taskConfigPath){
  $taskConfig=Get-Content -LiteralPath $taskConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if($taskConfig.extensionId -ne $ExtensionId){$taskConfig=$null}
}
if(-not $taskConfig){
  $taskBytes=New-Object byte[] 32
  $taskRandom=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$taskRandom.GetBytes($taskBytes)}finally{$taskRandom.Dispose()}
  $taskConfig=@{extensionId=$ExtensionId;pipe=('\\.\pipe\boss-job-search-'+[Guid]::NewGuid().ToString('N'));
    token=([BitConverter]::ToString($taskBytes).Replace('-','').ToLowerInvariant())}
  [IO.File]::WriteAllText($taskConfigPath,($taskConfig | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
$taskLauncher=Join-Path $taskDirectory 'boss-native-host.cmd'
$taskHost=Join-Path $taskPluginRoot 'src\native-host.mjs'
foreach($taskPath in @($taskRuntime,$taskHost,$taskConfigPath)){
  if($taskPath -match '[^\x20-\x7E]|[%!\r\n"]'){throw 'The native launcher requires ASCII paths without quotes, percent signs or exclamation marks.'}
}
$taskCommand='@echo off'+[Environment]::NewLine+'"'+$taskRuntime+'" "'+$taskHost+'" --config "'+$taskConfigPath+'" "%~1"'+[Environment]::NewLine
[IO.File]::WriteAllText($taskLauncher,$taskCommand,[Text.Encoding]::ASCII)
$taskManifestPath=Join-Path $taskDirectory 'host.json'
$taskManifest=@{name='com.boss_job_search.bridge';description='BOSS job search local bridge';path=$taskLauncher;
  type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}
[IO.File]::WriteAllText($taskManifestPath,($taskManifest | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$taskRegistry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.boss_job_search.bridge'
New-Item -Path $taskRegistry -Force | Out-Null
Set-Item -LiteralPath $taskRegistry -Value $taskManifestPath
Write-Output '本机通信已安装。请刷新已加载的求职扩展，新版启动后将自动连接。'
