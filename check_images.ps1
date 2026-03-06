Add-Type -AssemblyName System.Drawing
$basePath = "C:\Users\Jose\Desktop\APP Administrador flota uber-Didi\assets"
$files = @("icon-512.png","feature_graphic.png","screenshot-dashboard.png","screenshot-login.png")
foreach ($f in $files) {
    $path = Join-Path $basePath $f
    if (Test-Path $path) {
        $img = [System.Drawing.Image]::FromFile($path)
        Write-Host "$f : $($img.Width)x$($img.Height)"
        $img.Dispose()
    } else {
        Write-Host "$f : NO EXISTE"
    }
}
