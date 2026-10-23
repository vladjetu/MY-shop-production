<#
.SYNOPSIS
  Pošle testovací SAP snapshot na POST /api/sap-sync (docs/SAP-INTEGRATION.md §8).

.DESCRIPTION
  Secret sa číta VÝHRADNE z premennej prostredia SAP_SYNC_SECRET — nikdy ho
  nepíš do tohto súboru ani do Gitu.

.EXAMPLE
  $env:SAP_SYNC_SECRET = "<secret>"
  powershell -ExecutionPolicy Bypass -File .\tools\sap-agent\test-sync.ps1 -Url http://localhost:3000/api/sap-sync

.EXAMPLE
  # Aktuálne dáta (generatedAt = teraz) na Vercel:
  .\tools\sap-agent\test-sync.ps1 -Url https://my-shop-production.vercel.app/api/sap-sync -GeneratedAt now

.EXAMPLE
  # Neaktuálne dáta (vek > 60 min):
  .\tools\sap-agent\test-sync.ps1 -Url http://localhost:3000/api/sap-sync -GeneratedAt "2026-10-22T09:00:00+02:00"
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  # Predvolene sample-payload.json vedľa skriptu (doplní sa nižšie — v param()
  # je $PSScriptRoot vo Windows PowerShell 5.1 ešte prázdny).
  [string]$PayloadPath,

  # ISO 8601 s offsetom, alebo "now" = aktuálny čas tohto počítača.
  [string]$GeneratedAt
)

$ErrorActionPreference = "Stop"

if (-not $PayloadPath) { $PayloadPath = Join-Path $PSScriptRoot 'sample-payload.json' }

# AVD / Windows PowerShell 5.1 inak predvolene nemusí použiť TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$secret = $env:SAP_SYNC_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
  Write-Error "Chýba premenná prostredia SAP_SYNC_SECRET (napr. `$env:SAP_SYNC_SECRET = '...')."
  exit 1
}

$json = [IO.File]::ReadAllText((Resolve-Path $PayloadPath), [Text.Encoding]::UTF8)

if ($GeneratedAt) {
  if ($GeneratedAt -eq "now") {
    $GeneratedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
  }
  # Náhrada v surovom texte — ConvertFrom/ConvertTo-Json by v PowerShell 7 menil
  # formát dátumov a v 5.1 escapoval diakritiku.
  $pattern = '"generatedAt"\s*:\s*"[^"]*"'
  if ($json -notmatch $pattern) {
    Write-Error "V payloade sa nenašlo pole generatedAt."
    exit 1
  }
  $json = [regex]::Replace($json, $pattern, ('"generatedAt": "' + $GeneratedAt + '"'), 1)
}

$body = [Text.Encoding]::UTF8.GetBytes($json)
Write-Host "POST $Url ($($body.Length) B$(if ($GeneratedAt) { ", generatedAt=$GeneratedAt" }))"

try {
  $response = Invoke-RestMethod -Method Post -Uri $Url `
    -ContentType "application/json; charset=utf-8" `
    -Headers @{ "x-sap-sync-secret" = $secret } `
    -Body $body
  Write-Host "OK:" ($response | ConvertTo-Json -Compress)
}
catch {
  $status = $null
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  Write-Host "CHYBA: HTTP $status"
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  else { Write-Host $_.Exception.Message }
  exit 1
}
