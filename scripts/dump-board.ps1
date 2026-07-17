# Downsample the 6000x4000 board to a raw RGB grid for extract-geography.mjs.
#
# Node has no image decoder and this repo stays dependency-free, so System.Drawing
# does the decoding and hands over plain bytes. Downsampling with bicubic
# averaging is deliberate: it melts the thin sector grid and the road hairlines
# into their surroundings, which is exactly what we want before classifying
# regions by colour.
param(
  [int]$Width = 1000,
  [string]$Out = "C:\Users\tgehl\friedrich\docs\assets\extraction\board-grid"
)
Add-Type -AssemblyName System.Drawing
$src = "C:\Users\tgehl\friedrich\docs\assets\vassal\board-6000x4000.png"
$img = [System.Drawing.Image]::FromFile($src)
$h = [int]([math]::Round($Width * $img.Height / $img.Width))

$bmp = New-Object System.Drawing.Bitmap $Width, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $Width, $h))
$g.Dispose()

# lock the bits and copy them out in one go — GetPixel per pixel is far too slow
$rect = New-Object System.Drawing.Rectangle 0, 0, $Width, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)

[System.IO.File]::WriteAllBytes("$Out.bin", $bytes)
$json = @{ width = $Width; height = $h; stride = $stride; boardWidth = $img.Width; boardHeight = $img.Height } | ConvertTo-Json
# WriteAllText, not Set-Content -Encoding utf8: PowerShell 5.1 prepends a BOM, which JSON.parse chokes on
[System.IO.File]::WriteAllText("$Out.json", $json)

$bmp.Dispose(); $img.Dispose()
"wrote $Out.bin  ($Width x $h, stride $stride) from $($img.Width)x$($img.Height)"
