param([string]$OutputPath)

$workspace = Split-Path -Parent $PSScriptRoot
$buildIndex = Join-Path $workspace 'build\index.html'
$compilerCandidates = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (!(Test-Path -LiteralPath $buildIndex)) {
  throw 'Production build not found. Run npm run build first.'
}
if (!$compiler) {
  throw 'Windows .NET Framework compiler not found.'
}

$tempRoot = Join-Path $workspace '.tmp'
$tempDirectory = Join-Path $tempRoot ('windows-launcher-' + [Guid]::NewGuid().ToString('N'))
$embeddedZip = Join-Path $tempDirectory 'app.zip'
$output = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $workspace 'Squoosh-Batch-Windows.exe' }

New-Item -ItemType Directory -Path $tempDirectory | Out-Null
try {
  Compress-Archive -Path @(
    (Join-Path $workspace 'build'),
    (Join-Path $workspace 'LICENSE'),
    (Join-Path $workspace 'BATCH-README.md')
  ) -DestinationPath $embeddedZip -CompressionLevel Optimal

  $frameworkDirectory = Split-Path -Parent $compiler
  $compilerArguments = @(
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    ('/out:' + $output),
    ('/win32icon:' + (Join-Path $workspace 'src\static-build\assets\favicon.ico')),
    ('/resource:' + $embeddedZip + ',SquooshApp'),
    ('/reference:' + (Join-Path $frameworkDirectory 'System.IO.Compression.dll')),
    ('/reference:' + (Join-Path $frameworkDirectory 'System.IO.Compression.FileSystem.dll')),
    ('/reference:' + (Join-Path $frameworkDirectory 'System.Windows.Forms.dll')),
    ('/reference:' + (Join-Path $frameworkDirectory 'System.Drawing.dll')),
    (Join-Path $workspace 'windows-launcher.cs')
  )
  & $compiler @compilerArguments
  if ($LASTEXITCODE -ne 0) { throw 'Windows launcher compilation failed.' }

  # Keep the optional Node launcher distribution on the same build as the EXE.
  $legacyDirectory = Join-Path $workspace 'Squoosh-Batch-Windows-2026-08-10'
  $legacyBuild = [IO.Path]::GetFullPath((Join-Path $legacyDirectory 'build'))
  $expectedBuild = [IO.Path]::GetFullPath((Join-Path $workspace 'Squoosh-Batch-Windows-2026-08-10\build'))
  if ($legacyBuild -ne $expectedBuild) { throw 'Unexpected distribution build path.' }
  if (Test-Path -LiteralPath $legacyBuild) {
    Remove-Item -LiteralPath $legacyBuild -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $workspace 'build') -Destination $legacyBuild -Recurse
}
finally {
  $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot) + [IO.Path]::DirectorySeparatorChar
  $resolvedTempDirectory = [IO.Path]::GetFullPath($tempDirectory)
  if ($resolvedTempDirectory.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTempDirectory -Recurse -Force
  }
}

Get-Item -LiteralPath $output
