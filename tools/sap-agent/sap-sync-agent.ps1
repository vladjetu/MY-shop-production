# sap-sync-agent.ps1  (verzia avd-ps-1.3)
# SAP B1 -> MY shop production. Cita otvorene e-shop zakazky (LEN SELECT) a posle ich na /api/sap-sync.
# Do SAP nic nezapisuje. SQL je napevno v skripte. Zdroj pravdy: docs/SAP-INTEGRATION.md
#
# Pouzitie (Windows PowerShell 64-bit na AVD):
#   -DryRun          : nacita data, ulozi payload.json, NIC neposle (prvy test)
#   -Once            : jeden sync a koniec
#   -Loop            : sync kazdych -IntervalMinutes minut, kym okno nezavries
#   -ResetCredentials: znova vyziada SAP meno/heslo a sync secret
#
# Hesla su ulozene sifrovane cez Windows DPAPI v %LOCALAPPDATA%\MerchyouSapAgent (citatelne len tvojim Windows uctom).

param(
    [switch]$DryRun,
    [switch]$Once,
    [switch]$Loop,
    [switch]$ResetCredentials,
    [int]$IntervalMinutes = 15,
    [string]$Url = "https://my-shop-production.vercel.app/api/sap-sync"
)

$ErrorActionPreference = "Stop"
$AgentVersion = "avd-ps-1.3"
$Server       = "C002SRAZSAPDB01"
$CompanyDB    = "Merchyou_prod"
$Dir          = Join-Path $env:LOCALAPPDATA "MerchyouSapAgent"
$CredFile     = Join-Path $Dir "sap-cred.xml"
$SecretFile   = Join-Path $Dir "sync-secret.xml"
$LogFile      = Join-Path $Dir "agent.log"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir | Out-Null }

function Write-Log([string]$msg, [string]$color = "Gray") {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line -ForegroundColor $color
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) {
        Move-Item $LogFile "$LogFile.old" -Force
    }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# ---------- Vypnutie QuickEdit ----------
# Klik do okna konzoly v QuickEdit rezime pozastavi skript, kym sa nestlaci klaves
# (agent tak raz stal takmer 4 hodiny). ENABLE_QUICK_EDIT_MODE (0x0040) vynulovat,
# ENABLE_EXTENDED_FLAGS (0x0080) ponechat, inak sa zmena neprejavi.
try {
    if (-not ("MerchyouSapAgent.ConsoleMode" -as [type])) {
        Add-Type -Namespace MerchyouSapAgent -Name ConsoleMode -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
"@
    }
    $hIn = [MerchyouSapAgent.ConsoleMode]::GetStdHandle(-10)
    $mode = [uint32]0
    if (-not [MerchyouSapAgent.ConsoleMode]::GetConsoleMode($hIn, [ref]$mode)) { throw "GetConsoleMode zlyhal (skript nebezi v konzole?)" }
    # 4294967231 = 0xFFFFFFBF (vsetky bity okrem 0x0040); hex literal by bol v PS 5.1 zaporny int32
    $newMode = [uint32]((([int64]$mode) -bor 0x0080) -band 4294967231)
    if (-not [MerchyouSapAgent.ConsoleMode]::SetConsoleMode($hIn, $newMode)) { throw "SetConsoleMode zlyhal" }
}
catch { Write-Log ("Varovanie: QuickEdit sa nepodarilo vypnut ({0}). Do okna agenta neklikaj." -f $_.Exception.Message) "Yellow" }

if (-not [Environment]::Is64BitProcess) { Write-Log "CHYBA: spusti 64-bit Windows PowerShell (nie x86)" "Red"; exit 1 }
if (-not ($DryRun -or $Once -or $Loop)) { Write-Host "Zadaj -DryRun, -Once alebo -Loop" -ForegroundColor Yellow; exit 1 }

# ---------- Prihlasovacie udaje (DPAPI) ----------
function Get-StoredCred([string]$file, [string]$prompt, [string]$fixedUser) {
    if (-not $ResetCredentials -and (Test-Path $file)) {
        try { return Import-Clixml $file }
        catch { Write-Log "Ulozene udaje sa nedaju desifrovat (iny pocitac?) - zadaj ich znova." "Yellow" }
    }
    if ($fixedUser) {
        while ($true) {
            $sec  = Read-Host $prompt -AsSecureString
            $cred = New-Object System.Management.Automation.PSCredential($fixedUser, $sec)
            $plain = $cred.GetNetworkCredential().Password
            $ok = ($plain.Length -ge 20) -and ($plain -notmatch '[\x00-\x1F]')
            $plain = $null
            if ($ok) { break }
            Write-Host "Kod je prilis kratky alebo obsahuje neplatny znak. Vloz ho PRAVYM klikom mysi (nie Ctrl+V)." -ForegroundColor Yellow
        }
    } else {
        $u    = Read-Host "SAP user"
        $sec  = Read-Host $prompt -AsSecureString
        $cred = New-Object System.Management.Automation.PSCredential($u, $sec)
    }
    $cred | Export-Clixml $file
    return $cred
}

$SapCred = Get-StoredCred $CredFile "SAP heslo" $null
if (-not $DryRun) { $SecretCred = Get-StoredCred $SecretFile "SAP_SYNC_SECRET (vloz kod)" "sap-sync" }

# ---------- SQL (LEN SELECT, napevno) ----------
$Filter = "T0.NumAtCard LIKE 'merchyou.shop:#%' AND T0.DocStatus = 'O' AND T0.CANCELED = 'N' AND ISNULL(T0.U_SFT_SPECIAL, '') <> 'REKLAM'"

$SqlHead = @"
SELECT T0.DocEntry, T0.DocNum, T0.NumAtCard, T0.U_SFT_DOCTYPE, T0.U_SFT_SPECIAL, T0.U_SFT_STATUS,
       T0.U_SFT_PRIORITY, T0.U_SFT_NOPRINT, T0.TrnspCode, T1.TrnspName, T0.U_PICKUPID, T0.U_PICKUPNAME,
       T0.UpdateDate, T0.UpdateTS, U.U_NAME AS UpdatedBy
FROM ORDR T0
LEFT JOIN OSHP T1 ON T0.TrnspCode = T1.TrnspCode
LEFT JOIN OUSR U ON T0.UserSign2 = U.USERID
WHERE $Filter
"@

$SqlLines = @"
SELECT L.DocEntry, L.LineNum, L.ItemCode, L.Dscription, L.Quantity
FROM RDR1 L
JOIN ORDR T0 ON T0.DocEntry = L.DocEntry
WHERE $Filter AND L.ItemCode NOT LIKE 'S%'
"@

$SqlHist = @"
SELECT A.DocEntry, A.LogInstanc, A.UpdateDate, A.UpdateTS, U.U_NAME AS UpdatedBy
FROM ADOC A
JOIN ORDR T0 ON T0.DocEntry = A.DocEntry
LEFT JOIN OUSR U ON A.UserSign2 = U.USERID
WHERE A.ObjType = '17' AND $Filter
"@

$SqlHistLines = @"
SELECT B.DocEntry, B.LogInstanc, B.LineNum, B.ItemCode, B.Dscription, B.Quantity
FROM ADO1 B
JOIN ORDR T0 ON T0.DocEntry = B.DocEntry
WHERE B.ObjType = '17' AND $Filter AND B.ItemCode NOT LIKE 'S%'
"@

foreach ($q in @($SqlHead, $SqlLines, $SqlHist, $SqlHistLines)) {
    if ($q -notmatch '^\s*SELECT\s' -or $q -match '\b(INSERT|UPDATE|DELETE|DROP|ALTER|EXEC|MERGE|TRUNCATE)\b') {
        Write-Log "CHYBA: povoleny je len SELECT" "Red"; exit 1
    }
}

# ---------- Pomocne funkcie ----------
function Get-Rows($company, [string]$sql) {
    $rs = $company.GetBusinessObject(300)
    try {
        $rs.DoQuery($sql)
        $rows = New-Object System.Collections.Generic.List[object]
        while (-not $rs.EoF) {
            $o = @{}
            for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
                $fld = $rs.Fields.Item($i)
                $o[$fld.Name] = $fld.Value
            }
            $rows.Add($o)
            $rs.MoveNext()
        }
        return ,$rows
    }
    finally { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($rs) }
}

function Get-Str($v) { if ($null -eq $v) { return $null }; $s = ([string]$v).Trim(); if ($s -eq "") { return $null }; return $s }

# SAP UpdateDate + UpdateTS (HHMMSS) -> "yyyy-MM-ddTHH:mm:ss" (lokalny cas SAP servera, bez zony)
function Get-Stamp($date, $ts) {
    if ($null -eq $date) { return $null }
    $d = [datetime]$date
    if ($d.Year -lt 1901) { return $null }
    $t = 0; if ($ts) { $t = [int]$ts }
    $h = [math]::Floor($t / 10000); $m = [math]::Floor(($t % 10000) / 100); $s = $t % 100
    return $d.Date.AddHours($h).AddMinutes($m).AddSeconds($s).ToString("yyyy-MM-ddTHH:mm:ss")
}

function New-Line($r) {
    return [ordered]@{
        lineNum     = [int]$r["LineNum"]
        itemCode    = Get-Str $r["ItemCode"]
        description = Get-Str $r["Dscription"]
        quantity    = [double]$r["Quantity"]
    }
}

function Send-Payload([string]$json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $secret = $SecretCred.GetNetworkCredential().Password
    try {
        $resp = Invoke-WebRequest -Uri $Url -Method Post -Body $bytes -ContentType "application/json; charset=utf-8" `
                -Headers @{ "x-sap-sync-secret" = $secret } -UseBasicParsing -TimeoutSec 60
        return @{ ok = $true; status = [int]$resp.StatusCode; body = $resp.Content }
    }
    catch {
        $status = 0; $body = $_.Exception.Message
        $r = $_.Exception.Response
        if ($r) {
            $status = [int]$r.StatusCode
            try { $sr = New-Object System.IO.StreamReader($r.GetResponseStream()); $body = $sr.ReadToEnd() } catch {}
        }
        return @{ ok = $false; status = $status; body = $body }
    }
    finally { $secret = $null }
}

# ---------- Jeden sync ----------
function Invoke-Sync {
    # Cas citania dat (vek dat v appke) - zaznamenany PRED citanim zo SAP, nie pri
    # skladani payloadu, aby oneskorene odoslanie nevyzeralo ako cerstve data
    $generatedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    $company = $null
    try {
        $company = New-Object -ComObject SAPbobsCOM.Company
        $company.Server       = $Server
        $company.CompanyDB    = $CompanyDB
        $company.DbServerType = 15
        $company.UserName     = $SapCred.UserName
        $company.Password     = $SapCred.GetNetworkCredential().Password
        $company.language     = 3
        if ($company.Connect() -ne 0) {
            Write-Log ("SAP Connect() zlyhal: [{0}] {1}" -f $company.GetLastErrorCode(), $company.GetLastErrorDescription()) "Red"
            return
        }

        $heads     = Get-Rows $company $SqlHead
        $lines     = Get-Rows $company $SqlLines
        $hist      = Get-Rows $company $SqlHist
        $histLines = Get-Rows $company $SqlHistLines
    }
    catch {
        Write-Log "Chyba pri citani zo SAP: $($_.Exception.Message)" "Red"
        return
    }
    finally {
        if ($company) {
            if ($company.Connected) { $company.Disconnect() }
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($company)
        }
    }

    # zoskupenie riadkov a historie podla DocEntry
    $linesBy = @{}
    foreach ($r in $lines) {
        $k = [int]$r["DocEntry"]
        if (-not $linesBy.ContainsKey($k)) { $linesBy[$k] = New-Object System.Collections.Generic.List[object] }
        $linesBy[$k].Add((New-Line $r))
    }
    $histLinesBy = @{}
    foreach ($r in $histLines) {
        $k = "{0}|{1}" -f [int]$r["DocEntry"], [int]$r["LogInstanc"]
        if (-not $histLinesBy.ContainsKey($k)) { $histLinesBy[$k] = New-Object System.Collections.Generic.List[object] }
        $histLinesBy[$k].Add((New-Line $r))
    }
    $histBy = @{}
    foreach ($r in ($hist | Sort-Object { [int]$_["LogInstanc"] })) {
        $de = [int]$r["DocEntry"]; $li = [int]$r["LogInstanc"]
        if (-not $histBy.ContainsKey($de)) { $histBy[$de] = New-Object System.Collections.Generic.List[object] }
        $hk = "{0}|{1}" -f $de, $li
        $histBy[$de].Add([ordered]@{
            logInstance = $li
            updatedAt   = Get-Stamp $r["UpdateDate"] $r["UpdateTS"]
            updatedBy   = Get-Str $r["UpdatedBy"]
            lines       = @(if ($histLinesBy.ContainsKey($hk)) { $histLinesBy[$hk] })
        })
    }

    $orders = New-Object System.Collections.Generic.List[object]
    foreach ($h in ($heads | Sort-Object { [int]$_["DocNum"] })) {
        $de = [int]$h["DocEntry"]
        $special = Get-Str $h["U_SFT_SPECIAL"]; if ($special -eq "-") { $special = $null }
        $orders.Add([ordered]@{
            docEntry  = $de
            docNum    = [int64]$h["DocNum"]
            numAtCard = Get-Str $h["NumAtCard"]
            docType   = Get-Str $h["U_SFT_DOCTYPE"]
            special   = $special
            status    = Get-Str $h["U_SFT_STATUS"]
            priority  = Get-Str $h["U_SFT_PRIORITY"]
            noPrint   = ((Get-Str $h["U_SFT_NOPRINT"]) -eq "Y")
            shipping  = [ordered]@{
                code            = [int]$h["TrnspCode"]
                name            = Get-Str $h["TrnspName"]
                pickupPointId   = Get-Str $h["U_PICKUPID"]
                pickupPointName = Get-Str $h["U_PICKUPNAME"]
            }
            updatedAt = Get-Stamp $h["UpdateDate"] $h["UpdateTS"]
            updatedBy = Get-Str $h["UpdatedBy"]
            # @( ) zabezpeci, ze aj 1 polozka zostane v JSON ako pole (PowerShell 5.1 inak pole s 1 prvkom rozbali)
            lines     = @(if ($linesBy.ContainsKey($de)) { $linesBy[$de] })
            history   = @(if ($histBy.ContainsKey($de)) { $histBy[$de] })
        })
    }

    $shopifyCount = ($orders | ForEach-Object { $_.numAtCard } | Sort-Object -Unique | Measure-Object).Count
    $histCount    = ($orders | Where-Object { $_.history.Count -gt 0 } | Measure-Object).Count
    Write-Log ("Nacitane zo SAP: {0} ZL, {1} objednavok, {2} ZL s historiou" -f $orders.Count, $shopifyCount, $histCount) "Cyan"

    if ($orders.Count -eq 0) {
        Write-Log "Ziadne otvorene e-shop ZL - nic sa neposiela (ochrana pred vymazanim)." "Yellow"
        return
    }

    $payload = [ordered]@{
        schemaVersion = 1
        generatedAt   = $generatedAt
        agent         = $AgentVersion
        orders        = $orders
    }
    $json = $payload | ConvertTo-Json -Depth 12 -Compress

    if ($DryRun) {
        $out = Join-Path $Dir "payload.json"
        [System.IO.File]::WriteAllText($out, ($payload | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
        Write-Log ("DryRun: payload ulozeny do {0} ({1} B), nic sa neposlalo." -f $out, $json.Length) "Green"
        return
    }

    $res = Send-Payload $json
    if ($res.ok) {
        Write-Log ("OK {0}: {1}" -f $res.status, $res.body) "Green"
        # Server vynechava neplatne ZL (skipped) - zalogovat, nech sa daju opravit v SAP
        $parsed = $null
        try { $parsed = $res.body | ConvertFrom-Json } catch {}
        if ($parsed -and $parsed.skipped) {
            $skipped = @($parsed.skipped)
            if ($skipped.Count -gt 0) {
                $nums = ($skipped | ForEach-Object { if ($null -ne $_.docNum) { $_.docNum } else { "?" } }) -join ", "
                Write-Log ("Vynechane ZL ({0}): {1}" -f $skipped.Count, $nums) "Yellow"
            }
        }
    }
    else         { Write-Log ("CHYBA HTTP {0}: {1}" -f $res.status, $res.body) "Red" }
}

# ---------- Spustenie ----------
Write-Log ("Agent {0} start ({1}), ciel: {2}" -f $AgentVersion, $(if ($DryRun) {"DryRun"} elseif ($Loop) {"Loop $IntervalMinutes min"} else {"Once"}), $Url)
if ($Loop -and -not $DryRun) {
    while ($true) {
        # Neocakavana chyba v jednom cykle nesmie ukoncit agenta - pokracuje sa dalsim cyklom
        try { Invoke-Sync }
        catch { Write-Log ("CHYBA pri synchronizacii: {0}" -f $_.Exception.Message) "Red" }
        Write-Log ("Dalsi sync o {0} min. Okno nechaj otvorene (minimalizuj ho)." -f $IntervalMinutes)
        Start-Sleep -Seconds ($IntervalMinutes * 60)
    }
} else {
    try { Invoke-Sync }
    catch { Write-Log ("CHYBA pri synchronizacii: {0}" -f $_.Exception.Message) "Red" }
}