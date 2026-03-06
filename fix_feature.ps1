Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Jose\.gemini\antigravity\brain\db454275-39c6-4db7-9579-1afee5316261\feature_graphic_1024x500_1772579863315.png"
$dstPath = "C:\Users\Jose\Desktop\APP Administrador flota uber-Didi\assets\feature_graphic_fixed.png"

$img = [System.Drawing.Image]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap(1024, 500)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Calculate crop/resize to fill 1024x500
$srcRatio = $img.Width / $img.Height
$dstRatio = 1024.0 / 500.0

if ($srcRatio -gt $dstRatio) {
    # Source is wider, crop sides
    $newHeight = $img.Height
    $newWidth = [int]($img.Height * $dstRatio)
    $srcX = [int](($img.Width - $newWidth) / 2)
    $srcRect = New-Object System.Drawing.Rectangle($srcX, 0, $newWidth, $newHeight)
}
else {
    # Source is taller, crop top/bottom
    $newWidth = $img.Width
    $newHeight = [int]($img.Width / $dstRatio)
    $srcY = [int](($img.Height - $newHeight) / 2)
    $srcRect = New-Object System.Drawing.Rectangle(0, $srcY, $newWidth, $newHeight)
}

$dstRect = New-Object System.Drawing.Rectangle(0, 0, 1024, 500)
$g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$img.Dispose()
$bmp.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# Verify
$verify = [System.Drawing.Image]::FromFile($dstPath)
Write-Host "feature_graphic_fixed.png: $($verify.Width)x$($verify.Height)"
$verify.Dispose()
Write-Host "DONE"
