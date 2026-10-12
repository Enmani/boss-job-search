param([string]$OutDirectory)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $OutDirectory){$OutDirectory=Join-Path $taskRoot 'dist'}
$taskOut=[IO.Path]::GetFullPath($OutDirectory)
$taskPackage=Get-Content -LiteralPath (Join-Path $taskRoot 'plugin/package.json') -Raw | ConvertFrom-Json
$taskVersion=$taskPackage.version
if($taskVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'Expected a numeric release version.'}
foreach($taskFile in @('plugin/.codex-plugin/plugin.json','plugin/chrome-extension/manifest.json')){
  $taskMetadata=Get-Content -LiteralPath (Join-Path $taskRoot $taskFile) -Raw | ConvertFrom-Json
  if($taskMetadata.version -ne $taskVersion){throw "Version mismatch: $taskFile"}
}
$taskDirty=@(git -C $taskRoot status --porcelain)
if($LASTEXITCODE -ne 0 -or $taskDirty.Count){throw 'Commit the reviewed source before packaging.'}
$taskFiles=@(git -C $taskRoot ls-files)
if($LASTEXITCODE -ne 0){throw 'Cannot list source files.'}
$taskForbidden='(^|/)(node_modules|\.git|data|runtime|work|dist|bridge)(/|$)|\.sqlite[^/]*$|\.log$|(^|/)\.env[^/]*$'
foreach($taskFile in $taskFiles){
  if($taskFile -match $taskForbidden){throw "Private or runtime file tracked: $taskFile"}
}
New-Item -ItemType Directory -Path $taskOut -Force | Out-Null
$taskSourceZip=Join-Path $taskOut "boss-job-search-v$taskVersion-source.zip"
$taskChromeZip=Join-Path $taskOut "boss-job-search-v$taskVersion-chrome-extension.zip"
git -C $taskRoot archive --format=zip "--prefix=boss-job-search-$taskVersion/" "--output=$taskSourceZip" HEAD
if($LASTEXITCODE -ne 0){throw 'Source archive failed.'}
git -C $taskRoot archive --format=zip --prefix=boss-job-search-chrome-extension/ "--output=$taskChromeZip" HEAD:plugin/chrome-extension
if($LASTEXITCODE -ne 0){throw 'Chrome archive failed.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach($taskZip in @($taskSourceZip,$taskChromeZip)){
  $taskArchive=[IO.Compression.ZipFile]::OpenRead($taskZip)
  try{
    foreach($taskEntry in $taskArchive.Entries){
      if($taskEntry.FullName -match $taskForbidden){throw "Runtime file in archive: $($taskEntry.FullName)"}
    }
    if(-not ($taskArchive.Entries.FullName -match '(^|/)LICENSE$')){throw 'Archive is missing its license.'}
  }finally{$taskArchive.Dispose()}
  Get-Item -LiteralPath $taskZip | Select-Object Name,Length,FullName
}
