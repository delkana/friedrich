# Print the board's colour at given board coordinates: "x,y" pairs.
# Used to design the land/sea classifier in extract-geography.mjs.
param([Parameter(ValueFromRemainingArguments)][string[]]$Points)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("C:\Users\tgehl\friedrich\docs\assets\vassal\board-6000x4000.png")
$bmp = New-Object System.Drawing.Bitmap $img
foreach ($p in $Points) {
  $xy = $p.Split(',')
  $x = [int]$xy[0]; $y = [int]$xy[1]
  $c = $bmp.GetPixel($x, $y)
  "{0,6},{1,-6} rgb({2,3},{3,3},{4,3})  #{2:X2}{3:X2}{4:X2}" -f $x, $y, $c.R, $c.G, $c.B
}
$bmp.Dispose(); $img.Dispose()
