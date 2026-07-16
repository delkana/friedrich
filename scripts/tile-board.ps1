# Slice the board scan into overlapping, upscaled tiles for visual transcription.
# Each tile is named tile-<col>-<row>.png and covers a region of the source image;
# tiles.json records the exact source-pixel rect of every tile so transcribed
# pixel coordinates can be mapped back to board coordinates.

param(
  [string]$Source = "C:\Users\tgehl\friedrich\docs\assets\board-scan.jpg",
  [string]$OutDir = "C:\Users\tgehl\friedrich\docs\assets\tiles",
  [int]$Cols = 6,
  [int]$Rows = 4,
  [int]$Overlap = 60,   # source pixels of overlap on each edge
  [int]$Scale = 3       # upscale factor for legibility
)

Add-Type -AssemblyName System.Drawing
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }

$img = [System.Drawing.Image]::FromFile($Source)
$tileW = [math]::Ceiling($img.Width / $Cols)
$tileH = [math]::Ceiling($img.Height / $Rows)
$index = @()

for ($r = 0; $r -lt $Rows; $r++) {
  for ($c = 0; $c -lt $Cols; $c++) {
    $x0 = [math]::Max(0, $c * $tileW - $Overlap)
    $y0 = [math]::Max(0, $r * $tileH - $Overlap)
    $x1 = [math]::Min($img.Width, ($c + 1) * $tileW + $Overlap)
    $y1 = [math]::Min($img.Height, ($r + 1) * $tileH + $Overlap)
    $w = $x1 - $x0; $h = $y1 - $y0

    $bmp = New-Object System.Drawing.Bitmap ($w * $Scale), ($h * $Scale)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $src = New-Object System.Drawing.Rectangle $x0, $y0, $w, $h
    $dst = New-Object System.Drawing.Rectangle 0, 0, ($w * $Scale), ($h * $Scale)
    $g.DrawImage($img, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $name = "tile-$c-$r.png"
    $bmp.Save((Join-Path $OutDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    $index += [pscustomobject]@{ name = $name; col = $c; row = $r; x = $x0; y = $y0; w = $w; h = $h; scale = $Scale }
  }
}

$img.Dispose()
$index | ConvertTo-Json | Out-File (Join-Path $OutDir "tiles.json") -Encoding utf8
"Wrote $($index.Count) tiles ($Cols x $Rows, overlap $Overlap, scale $Scale) to $OutDir"
