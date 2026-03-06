Add-Type -AssemblyName System.Drawing

$basePath = "C:\Users\Jose\Desktop\APP Administrador flota uber-Didi\assets"

# 1. Resize icon to 512x512
$iconPath = Join-Path $basePath "icon-512.png"
$img = [System.Drawing.Image]::FromFile($iconPath)
$bmp = New-Object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, 512, 512)
$g.Dispose()
$img.Dispose()
$bmp.Save((Join-Path $basePath "icon-512-fixed.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "icon-512-fixed.png created: 512x512"

# 2. Fix screenshots to 1920x1080 (16:9) by adding black bars at bottom
foreach ($name in @("screenshot-dashboard.png","screenshot-login.png")) {
    $path = Join-Path $basePath $name
    $img = [System.Drawing.Image]::FromFile($path)
    $bmp = New-Object System.Drawing.Bitmap(1920, 1080)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(26, 26, 46))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, 1920, 922)
    $g.Dispose()
    $img.Dispose()
    $fixedName = $name.Replace(".png", "-fixed.png")
    $bmp.Save((Join-Path $basePath $fixedName), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "$fixedName created: 1920x1080"
}

Write-Host "ALL DONE"
