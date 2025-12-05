# TTS Setup Guide for Windows

This guide explains how to set up the TTS (Text-to-Speech) environment for the Ko-AD project on Windows.

## Prerequisites

### 1. Python Installation

**Recommended: Python 3.11 or 3.12**

Python 3.13+ requires additional setup (audioop-lts). For simplicity, use Python 3.11 or 3.12.

**Option A: Use Python 3.11/3.12 (Recommended)**
- Download from: https://www.python.org/downloads/
- During installation, check "Add Python to PATH"
- Verify: `python --version` should show 3.11.x or 3.12.x

**Option B: Use Python 3.13+**
- Requires `audioop-lts` package (see below)

### 2. FFmpeg Installation

**Option A: Using WinGet (Recommended)**
```powershell
winget install "FFmpeg (Essentials Build)"
```

After installation, add FFmpeg to PATH:

1. Find FFmpeg installation path (usually):
   ```
   C:\Users\<YourUsername>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0-essentials_build\bin
   ```

2. Add to PATH using PowerShell (as Administrator):
   ```powershell
   $ffmpegBinPath = "C:\Users\HS\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0-essentials_build\bin"
   $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
   if ($currentPath -notlike "*$ffmpegBinPath*") {
       [Environment]::SetEnvironmentVariable("Path", "$currentPath;$ffmpegBinPath", "User")
       Write-Host "FFmpeg added to PATH. Please restart your terminal."
   }
   ```

3. **Restart your terminal/PowerShell** for PATH changes to take effect.

4. Verify:
   ```powershell
   ffmpeg -version
   ```

**Option B: Manual Installation**
1. Download FFmpeg for Windows: https://ffmpeg.org/download.html
   - Or use: https://www.gyan.dev/ffmpeg/builds/
2. Extract to a folder (e.g., `C:\ffmpeg`)
3. Add to PATH:
   - Open System Properties → Environment Variables
   - Add `C:\ffmpeg\bin` to PATH
4. Restart terminal and verify:
   ```powershell
   ffmpeg -version
   ```

### 3. Python Dependencies

Navigate to the `python` directory and install dependencies:

```powershell
cd Cursor\python
pip install -r requirements.txt
```

**For Python 3.13+ only:**
```powershell
pip install audioop-lts
```

## Environment Configuration

### Setting Python Executable Path (Windows)

If Python is not in your PATH, or you want to use a specific Python interpreter:

1. Find your Python executable:
   ```powershell
   where python
   # Or for a venv:
   # C:\path\to\venv\Scripts\python.exe
   ```

2. Set environment variable in PowerShell (temporary):
   ```powershell
   $env:PYTHON_TTS_EXECUTABLE = "C:\path\to\python.exe"
   ```

3. Or set permanently:
   - Open System Properties → Environment Variables
   - Add new variable:
     - Name: `PYTHON_TTS_EXECUTABLE`
     - Value: `C:\path\to\python.exe`

4. Restart your backend server after setting the variable.

## Testing TTS Setup

### Manual Test (PowerShell)

```powershell
# Test Python and dependencies
python -c "import pydub; import gtts; import ffmpeg; import pandas; print('All imports OK')"

# Test ffmpeg
ffmpeg -version

# Test audioop (Python 3.13+)
python -c "import audioop_lts; print('audioop-lts OK')"
```

### Test via API

```powershell
# Make sure backend is running on port 4000
# Make sure you have a video uploaded and AD generated

$videoId = "your-video-id-here"
$body = @{ videoId = $videoId } | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/generate-tts" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

Expected response:
```json
{
  "status": "ok",
  "videoId": "...",
  "adVideoUrl": "/static/tts/..._ad_mix.mp4",
  "adAudioUrl": "/static/tts/..._ad_mix.wav",
  "meta": {
    "usedSegments": 10,
    "cutSegments": 2
  }
}
```

## Troubleshooting

### Error: `[WinError 2] 지정된 파일을 찾을 수 없습니다`

**Possible causes:**
1. Python executable not found
   - **Solution**: Set `PYTHON_TTS_EXECUTABLE` environment variable
2. FFmpeg not in PATH
   - **Solution**: Install FFmpeg and add to PATH
3. Input files not found
   - **Solution**: Check backend logs for exact file paths

### Error: `ModuleNotFoundError: No module named 'audioop'`

**Cause**: Python 3.13+ without audioop-lts

**Solution**:
```powershell
pip install audioop-lts
```

### Error: `ffmpeg not found in system PATH`

**Solution**: 
1. Install FFmpeg
2. Add to PATH
3. Restart terminal/backend server

## File Locations

After successful TTS generation:
- **Output directory**: `Cursor/server/storage/tts/`
- **Video file**: `{videoId}_ad_mix.mp4`
- **Audio file**: `{videoId}_ad_mix.wav`
- **Accessible via**: `http://localhost:4000/static/tts/{videoId}_ad_mix.mp4`

## Backend Logs

When TTS is called, check backend console for detailed logs:
- `[TTS:xxx]` - Request tracking
- `[TTS Python]` - Python script output
- All paths are logged as absolute paths for debugging

## Exporting Videos with AD Audio

After generating TTS, you can render and download the AD-mixed video directly from the browser.

### Backend Endpoint

- `POST /api/export-with-ad`
- Request body example:

```json
{
  "videoId": "your-video-id",
  "serverPath": "C:\\\\Users\\\\HS\\\\Documents\\\\GitHub\\\\Ko-AD\\\\Cursor\\\\server\\\\storage\\\\uploads\\\\your-video-id.mp4",
  "adSegments": [
    { "id": 1, "start": 12.5, "end": 16.0, "text": "설명 텍스트" }
  ],
  "options": {
    "language": "ko"
  }
}
```

- Response example:

```json
{
  "status": "ok",
  "videoId": "your-video-id",
  "downloadUrl": "/static/exports/your-video-id_ad_export_2025-01-01T12-34-56-789Z.mp4",
  "fileName": "your-video-id_ad_export_2025-01-01T12-34-56-789Z.mp4",
  "meta": {
    "fileSize": 12345678,
    "adSegments": 8,
    "mixOptions": {
      "language": "ko"
    },
    "audioMixSource": "ad_mix_wav"
  }
}
```

### Download Flow

1. Frontend calls `/api/export-with-ad`.
2. Backend combines the original video stream with the TTS `*_ad_mix.wav` audio (or copies the previously generated AD video).
3. Exported files are stored under `Cursor/server/storage/exports/`.
4. Files are served via `/static/exports/*`. The frontend triggers a browser download so the user can choose the save location.

### Manual Test (PowerShell)

```powershell
$videoId = "your-video-id"
$body = @{
  videoId = $videoId
  serverPath = "C:\Users\HS\Documents\GitHub\Ko-AD\Cursor\server\storage\uploads\$videoId.mp4"
  adSegments = @()
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/export-with-ad" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

The response contains `downloadUrl` that you can open in the browser (e.g., `http://localhost:5173/static/exports/...`) to save the rendered video.

> Note: We currently keep exported files for manual cleanup. Delete files under `Cursor/server/storage/exports/` periodically if disk usage grows.

