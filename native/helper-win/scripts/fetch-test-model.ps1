# Downloads what the helper's --self-test needs to transcribe a known recording: the small English
# whisper.cpp model and jfk.wav (a public-domain recording, from whisper.cpp's samples). Each is
# checked against its SHA-256, and the folder is printed. The file is a test
# fixture for CI and for a developer's own check; the app itself uses the model in
# packages/shared/src/speech-models-windows.ts. Nothing here is committed.
param([string]$Folder = (Join-Path ([System.IO.Path]::GetTempPath()) 'murmur-test-speech-model'))

$url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.en.bin'
$sha256 = '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'
$file = Join-Path $Folder 'ggml-tiny.en.bin'
$wavUrl = 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.2/samples/jfk.wav'
$wavSha256 = '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e'
$wav = Join-Path $Folder 'jfk.wav'

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
if (-not (Test-Path $file) -or (Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -ne $sha256) {
  Invoke-WebRequest -Uri $url -OutFile $file
}
$actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $sha256) {
  Remove-Item $file -Force
  throw "the test model does not match its checksum ($actual)"
}
if (-not (Test-Path $wav) -or (Get-FileHash $wav -Algorithm SHA256).Hash.ToLower() -ne $wavSha256) {
  Invoke-WebRequest -Uri $wavUrl -OutFile $wav
}
$actualWav = (Get-FileHash $wav -Algorithm SHA256).Hash.ToLower()
if ($actualWav -ne $wavSha256) {
  Remove-Item $wav -Force
  throw "the test recording does not match its checksum ($actualWav)"
}
Write-Output $Folder
