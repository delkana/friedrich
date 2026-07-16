# Crop a region of the 6000x4000 board for visual verification.
param(
  [Parameter(Mandatory)][int]$X,
  [Parameter(Mandatory)][int]$Y,
  [int]$Radius = 450,
  [double]$Scale = 1.0,
  [Parameter(Mandatory)][string]$Out
)
Add-Type -AssemblyName System.Drawing
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path (Get-Location).Path $Out }
$img = [System.Drawing.Image]::FromFile("C:\Users\tgehl\friedrich\docs\assets\vassal\board-6000x4000.png")
$x0 = [math]::Max(0, $X - $Radius); $y0 = [math]::Max(0, $Y - $Radius)
$x1 = [math]::Min($img.Width, $X + $Radius); $y1 = [math]::Min($img.Height, $Y + $Radius)
$w = $x1 - $x0; $h = $y1 - $y0
$bmp = New-Object System.Drawing.Bitmap ([int]($w * $Scale)), ([int]($h * $Scale))
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$src = New-Object System.Drawing.Rectangle $x0, $y0, $w, $h
$dst = New-Object System.Drawing.Rectangle 0, 0, ([int]($w * $Scale)), ([int]($h * $Scale))
$g.DrawImage($img, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $img.Dispose()
"cropped ($x0,$y0)-($x1,$y1) -> $Out"
