Param(
    [string]$OutputPath = "resources/icon.png",
    [int]$Size = 256
)

# Create resources directory if needed
$resDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $resDir)) { New-Item -ItemType Directory -Path $resDir | Out-Null }

Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.Clear([System.Drawing.Color]::FromArgb(255, 34, 34, 34))

# Draw a simple white 'S' for HomeBot
$font = New-Object System.Drawing.Font('Arial', 140, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0,0,$Size,$Size)
$gfx.DrawString('S', $font, $brush, $rect, $sf)

$bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
# Also create a .ico for Windows builds (build/icon.ico)
$icoPathRaw = Join-Path (Split-Path $OutputPath -Parent) "..\build\icon.ico"
$icoPath = [System.IO.Path]::GetFullPath($icoPathRaw)

# Ensure build directory exists
$buildDir = Split-Path $icoPath -Parent
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir -Force | Out-Null }

# Recreate the bitmap (we disposed it above) and save PNG again if needed
$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.Clear([System.Drawing.Color]::FromArgb(255, 34, 34, 34))
$font = New-Object System.Drawing.Font('Arial', 140, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0,0,$Size,$Size)
$gfx.DrawString('S', $font, $brush, $rect, $sf)

$bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Convert to .ico by creating an Icon from the HBitmap and saving it
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()

$gfx.Dispose()
$bmp.Dispose()

Write-Host "Wrote placeholder PNG to $OutputPath and ICO to $icoPath"