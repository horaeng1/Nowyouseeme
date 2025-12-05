const path = require('path');
const dotenv = require('dotenv');

// ⚠️ dotenv.config()를 가장 먼저 호출해야 다른 모듈에서 환경변수를 사용할 수 있습니다
dotenv.config();

const fs = require('fs/promises');
const fsSync = require('fs'); // For synchronous file operations like existsSync or streaming
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const { spawn } = require('child_process');

const JobStore = require('./jobStore');
const authRoutes = require('./authRoutes');
const { supabase, supabaseAdmin } = require('./supabaseClient');

const app = express();
const PORT = process.env.PORT || 4001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

const STORAGE_DIR = path.resolve(__dirname, '..', 'storage');
const UPLOAD_DIR = path.join(STORAGE_DIR, 'uploads');
const RESULT_DIR = path.join(STORAGE_DIR, 'results');
const AD_JSON_DIR = path.join(STORAGE_DIR, 'ad_json');
const TTS_DIR = path.join(STORAGE_DIR, 'tts');
const EXPORT_DIR = path.join(STORAGE_DIR, 'exports');
const RATINGS_DIR = path.join(STORAGE_DIR, 'ratings'); // 사용자 평가 정보 저장 디렉터리
const PYTHON_DIR = path.resolve(__dirname, '..', '..', 'python');
const PYTHON_SCRIPT_PATH = path.join(PYTHON_DIR, 'get_AD_gemini.py');
const TTS_SCRIPT_PATH = path.join(PYTHON_DIR, 'gemini_json_tts.py');

const jobStore = new JobStore(path.resolve(__dirname, '..', 'data', 'jobs.json'));
jobStore
  .init()
  .catch((err) => {
    console.error('JobStore 초기화 실패', err);
    process.exit(1);
  });

async function moveFileCrossDevice(sourcePath, destinationPath) {
  try {
    await fs.rename(sourcePath, destinationPath);
    return;
  } catch (err) {
    if (err.code !== 'EXDEV') {
      throw err;
    }
    console.warn('[FileMove] EXDEV detected, falling back to copy/delete:', {
      sourcePath,
      destinationPath
    });
  }

  await new Promise((resolve, reject) => {
    const readStream = fsSync.createReadStream(sourcePath);
    const writeStream = fsSync.createWriteStream(destinationPath);

    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);

    readStream.pipe(writeStream);
  });

  await fs.unlink(sourcePath);
}

async function ensureDirectories() {
  const TMP_DIR = path.resolve(__dirname, '..', 'tmp');
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log('[Init] 업로드 디렉터리 확인:', UPLOAD_DIR);
    await fs.mkdir(RESULT_DIR, { recursive: true });
    console.log('[Init] 결과 디렉터리 확인:', RESULT_DIR);
    await fs.mkdir(TMP_DIR, { recursive: true });
    console.log('[Init] 임시 디렉터리 확인:', TMP_DIR);
    await fs.mkdir(AD_JSON_DIR, { recursive: true });
    console.log('[Init] AD JSON 디렉터리 확인:', AD_JSON_DIR);
    await fs.mkdir(TTS_DIR, { recursive: true });
    console.log('[Init] TTS 디렉터리 확인:', TTS_DIR);
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    console.log('[Init] EXPORT 디렉터리 확인:', EXPORT_DIR);
    await fs.mkdir(RATINGS_DIR, { recursive: true });
    console.log('[Init] RATINGS 디렉터리 확인:', RATINGS_DIR);
  } catch (err) {
    console.error('[Init] 디렉터리 생성 실패:', err);
    throw err;
  }
}

ensureDirectories().catch((err) => {
  console.error('[Init] 초기화 실패:', err);
  process.exit(1);
});

app.use(cors({ origin: CLIENT_ORIGIN }));

// 모든 요청 로깅 (디버깅용)
app.use((req, res, next) => {
  console.log(`\n>>> [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json({ limit: '2mb' }));
// Increase body parser limit for file uploads (not used for multipart, but good to have)
app.use(express.urlencoded({ extended: true, limit: '10gb' }));
app.use('/files', express.static(STORAGE_DIR));
app.use('/static/upload', express.static(UPLOAD_DIR));
app.use('/static/tts', express.static(TTS_DIR));
app.use('/static/exports', express.static(EXPORT_DIR));

// 인증 라우트
app.use('/api/auth', authRoutes);

// Set server timeout for long-running operations (30 minutes)
// AD generation + TTS can take a long time for long videos
app.timeout = 1800000;

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const jobId = uuid();
    const ext = path.extname(file.originalname) || '.mp4';
    const storedName = `${jobId}${ext}`;
    req.__uploadMeta = { jobId, storedName };
    cb(null, storedName);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'video/mp4') {
      return cb(new Error('mp4 확장자만 허용됩니다.'));
    }
    cb(null, true);
  }
});

const statusEvents = (job, status, note) => {
  const events = job.events ?? [];
  return [...events, { timestamp: new Date().toISOString(), status, note }];
};

const sanitizeJob = (job) => {
  if (!job) return null;
  const { resultDiskPath, ...rest } = job;
  // Keep sourceDiskPath for AD generation (but don't expose resultDiskPath)
  return rest;
};

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function mergeVideoWithAudio({ videoPath, audioPath, outputPath, requestId }) {
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-c:v',
      'copy',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest',
      outputPath
    ];

    console.log(`[Export:${requestId}] Running ffmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;
      console.log(`[Export:${requestId}] [ffmpeg] ${line.trim()}`);
    });

    ffmpegProcess.on('error', (err) => {
      console.error(`[Export:${requestId}] Failed to start ffmpeg:`, err);
      reject(err);
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[Export:${requestId}] ffmpeg completed successfully`);
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`ffmpeg exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.post('/api/upload', upload.single('video'), async (req, res, next) => {
  try {
    console.log('[Upload] ========================================');
    console.log('[Upload] Request received at /api/upload');
    console.log('[Upload] Request method:', req.method);
    console.log('[Upload] Request URL:', req.url);
    console.log('[Upload] Request headers:', {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length']
    });
    console.log('[Upload] Request body keys:', Object.keys(req.body || {}));
    console.log('[Upload] Request file:', req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      encoding: req.file.encoding,
      mimetype: req.file.mimetype,
      size: req.file.size,
      tempPath: req.file.path
    } : 'NO FILE');

    if (!req.file) {
      console.error('[Upload] No file in request');
      return res.status(400).json({
        status: 'error',
        message: '업로드된 파일이 없습니다. FormData에 "video" 필드로 파일을 전송해주세요.'
      });
    }

    console.log('[Upload] 파일 업로드 시작:', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      tempPath: req.file.path
    });

    // 업로드 디렉터리 확인 및 생성
    try {
      await fs.access(UPLOAD_DIR);
      console.log('[Upload] 업로드 디렉터리 확인됨:', UPLOAD_DIR);
    } catch {
      console.log('[Upload] 업로드 디렉터리 생성 중:', UPLOAD_DIR);
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      console.log('[Upload] 업로드 디렉터리 생성 완료');
    }

    const uploadMeta = req.__uploadMeta || {};
    const jobId = uploadMeta.jobId || uuid();
    const ext = path.extname(req.file.originalname) || '.mp4';
    const storedName = uploadMeta.storedName || `${jobId}${ext}`;
    const destination = path.join(UPLOAD_DIR, storedName);
    
    console.log('[Upload] 파일 저장 준비:', {
      jobId,
      storedName,
      destination,
      from: req.file.path
    });

    if (!uploadMeta.jobId) {
      try {
        await moveFileCrossDevice(req.file.path, destination);
        console.log('[Upload] 파일 이동 완료 (fallback):', destination);
      } catch (renameError) {
        console.error('[Upload] 파일 이동 실패:', renameError);
        throw new Error(`파일 저장 실패: ${renameError.message}`);
      }
    } else {
      console.log('[Upload] Multer 저장 경로 사용:', destination);
    }

    // Verify file was saved
    try {
      const stats = await fs.stat(destination);
      console.log('[Upload] 저장된 파일 확인:', {
        path: destination,
        size: stats.size,
        exists: true
      });
    } catch (statError) {
      console.error('[Upload] 저장된 파일 확인 실패:', statError);
      throw new Error(`파일 저장 확인 실패: ${statError.message}`);
    }
    
    const relativePath = path.posix.join('uploads', storedName);

    const baseJob = {
      id: jobId,
      videoId: jobId, // Also include videoId for compatibility
      sourceFileName: req.file.originalname,
      sourceStoredName: storedName,
      sourceRelativePath: relativePath,
      sourceUrl: `/files/${relativePath}`,
      sourceDiskPath: destination,
      serverPath: destination, // Explicit server-side path for AD generation
      status: 'queued',
      resultRelativePath: null,
      resultUrl: null,
      resultDiskPath: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [{ timestamp: new Date().toISOString(), status: 'queued', note: '로컬 저장소 업로드 완료' }]
    };

    console.log('[Upload] Job 생성 중:', jobId);
    const job = await jobStore.add(baseJob);
    console.log('[Upload] Job 생성 완료:', jobId);
    console.log('[Upload] 파일 저장 경로:', destination);

    // Return response with explicit serverPath and originalVideoUrl
    const response = sanitizeJob(job);
    // Ensure serverPath and videoId are included in response
    if (job.serverPath) {
      response.serverPath = job.serverPath;
    } else if (job.sourceDiskPath) {
      response.serverPath = job.sourceDiskPath;
    }
    if (job.id) {
      response.videoId = job.id;
    }

    // Generate HTTP URL for frontend (not filesystem path)
    const videoFileName = path.basename(destination);
    const originalVideoUrl = `/static/upload/${videoFileName}`;
    response.originalVideoUrl = originalVideoUrl;

    console.log('[Upload] 업로드 완료 - 응답 전송:', {
      id: response.id,
      videoId: response.videoId,
      serverPath: response.serverPath,
      originalVideoUrl: response.originalVideoUrl,
      fileName: response.sourceFileName
    });

    res.json(response);
  } catch (error) {
    console.error('[Upload] 오류 발생:', error);
    console.error('[Upload] 오류 스택:', error.stack);

    // Return error response
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: error.message || '업로드 중 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
    next(error);
  }
});

/**
 * POST /api/upload-youtube
 * Handle YouTube URL download
 */
app.post('/api/upload-youtube', async (req, res, next) => {
  const requestId = Date.now().toString(36);
  console.log(`[YouTube:${requestId}] /api/upload-youtube called`);

  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ message: 'URL is required' });
    }

    console.log(`[YouTube:${requestId}] URL: ${url}`);

    // Create a job first to track status? Or wait for download?
    // Let's wait for download to get metadata, then create job.
    // Or create job as "downloading"?
    // For simplicity, let's download first (blocking) then create job.
    // Ideally this should be async with job ID returned immediately, but for MVP blocking is fine if not too long.
    // Actually, YouTube download can take time. 
    // But to reuse existing pipeline, we need a file on disk.

    // Let's use a temporary job ID or just wait. 
    // Given the user wants to "use it as input", we can just wait for download.

    const pythonScript = path.join(PYTHON_DIR, 'download_youtube.py');

    // Spawn python script
    const result = await new Promise((resolve, reject) => {
      const escapedUrl = url.replace(/"/g, '\\"');
      const escapedOutputDir = UPLOAD_DIR.replace(/\\/g, '\\\\');
      const escapedPythonDir = PYTHON_DIR.replace(/\\/g, '\\\\');

      const pythonCode = `
import sys
import json
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, stream=sys.stderr)

# Add the python directory to sys.path
python_dir = r'${escapedPythonDir}'
if python_dir not in sys.path:
    sys.path.insert(0, python_dir)

# Debug: Print sys.path to stderr
logging.info(f"sys.path: {sys.path}")
logging.info(f"Attempting to import from: {python_dir}")

try:
    from download_youtube import download_youtube_video
    result = download_youtube_video('${escapedUrl}', r'${escapedOutputDir}')
    print(json.dumps(result))
except ImportError as e:
    logging.error(f"ImportError: {e}")
    print(json.dumps({'error': f"ImportError: {str(e)}"}))
    sys.exit(1)
except Exception as e:
    logging.error(f"Error: {e}")
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
`;

      // Use 'python' on Windows, 'python3' on other platforms
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const pythonProcess = spawn(pythonCmd, ['-c', pythonCode]);

      let stdoutData = '';
      let stderrData = '';

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.log(`[YouTube:${requestId}] Python stderr: ${data} `);
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script exited with code ${code}: ${stderrData} `));
          return;
        }
        try {
          const rawOutput = stdoutData.trim();
          const jsonStart = rawOutput.indexOf('{');
          const jsonEnd = rawOutput.lastIndexOf('}');

          if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error('No JSON object found in output');
          }

          const jsonStr = rawOutput.substring(jsonStart, jsonEnd + 1);
          const result = JSON.parse(jsonStr);

          // Check for error (both 'error' field and 'status: error')
          if (result.error) {
            reject(new Error(result.error));
          } else if (result.status === 'error') {
            reject(new Error(result.message || 'YouTube download failed'));
          } else if (!result.path) {
            reject(new Error('Download succeeded but no file path returned'));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Python output: ${stdoutData} (Error: ${e.message})`));
        }
      });
    });

    console.log(`[YouTube:${requestId}] Download success: `, result);

    // Create Job
    const videoId = result.videoId;
    const jobId = uuid(); // Generate a unique Job ID

    const jobData = {
      id: jobId,
      status: 'queued',
      sourceFileName: result.filename,
      sourceDiskPath: result.path,
      sourceUrl: result.sourceUrl,
      youtubeId: result.videoId,
      duration: result.duration,
      title: result.title,
      fileUrl: `/static/upload/${jobId}.mp4`, // Use UUID filename as it will be renamed
      events: [
        { status: 'queued', note: 'YouTube download completed', time: new Date().toISOString() }
      ]
    };

    const job = await jobStore.add(jobData);

    // Rename file to match job ID (UUID)
    const newPath = path.join(UPLOAD_DIR, `${job.id}.mp4`);
    
    console.log(`[YouTube:${requestId}] Moving file:`, {
      from: result.path,
      to: newPath,
      resultKeys: Object.keys(result),
      resultStatus: result.status,
      pathType: typeof result.path
    });
    
    if (!result.path || typeof result.path !== 'string' || result.path.trim() === '') {
      throw new Error(`Download result missing valid path. path="${result.path}", type=${typeof result.path}, Result: ${JSON.stringify(result)}`);
    }
    
    // Verify source file exists before moving
    try {
      await fs.access(result.path);
      console.log(`[YouTube:${requestId}] Source file exists: ${result.path}`);
    } catch (accessErr) {
      throw new Error(`Source file does not exist: ${result.path}. Error: ${accessErr.message}`);
    }
    
    await moveFileCrossDevice(result.path, newPath);

    // Update job with new path
    job.sourceDiskPath = newPath;
    job.serverPath = newPath;
    await jobStore.update(job.id, { sourceDiskPath: newPath, serverPath: newPath });

    console.log(`[YouTube:${requestId}] Job created: ${job.id} `);

    const response = sanitizeJob(job);
    response.serverPath = newPath;
    response.videoId = job.id;
    // Ensure originalVideoUrl matches fileUrl
    response.originalVideoUrl = jobData.fileUrl;

    res.json(response);

  } catch (error) {
    console.error(`[YouTube:${requestId}]Error: `, error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'YouTube download failed'
    });
  }
});

app.get('/api/jobs', async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status) {
      console.log('[Jobs] 상태별 조회:', status);
      const jobs = await jobStore.findByStatus(status);
      return res.json(jobs.map(sanitizeJob));
    }
    console.log('[Jobs] 전체 조회');
    const jobs = await jobStore.all();
    res.json(jobs.map(sanitizeJob));
  } catch (error) {
    console.error('[Jobs] 오류 발생:', error);
    next(error);
  }
});

app.get('/api/jobs/next', async (req, res, next) => {
  try {
    const queued = await jobStore.findByStatus('queued');
    res.json(sanitizeJob(queued[0]) ?? null);
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id', async (req, res, next) => {
  try {
    const job = await jobStore.getById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job 을 찾을 수 없습니다.' });
    }
    res.json(sanitizeJob(job));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/progress', async (req, res, next) => {
  try {
    const { status, note } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'status 값이 필요합니다.' });
    }

    const job = await jobStore.getById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job 을 찾을 수 없습니다.' });
    }

    const updated = await jobStore.update(req.params.id, {
      status,
      events: statusEvents(job, status, note ?? '')
    });
    res.json(sanitizeJob(updated));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/result', async (req, res, next) => {
  try {
    const { resultRelativePath, resultFileName, note } = req.body;
    if (!resultRelativePath || !resultFileName) {
      return res.status(400).json({ message: 'resultRelativePath 와 resultFileName 이 필요합니다.' });
    }

    const job = await jobStore.getById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job 을 찾을 수 없습니다.' });
    }

    const sanitizedRelativePath = resultRelativePath.replace(/^[/\\]+/, '');
    const resultDiskPath = path.join(STORAGE_DIR, sanitizedRelativePath);

    const updated = await jobStore.update(req.params.id, {
      status: 'completed',
      resultRelativePath: sanitizedRelativePath,
      resultUrl: `/files/${sanitizedRelativePath.replace(/\\/g, '/')}`,
      resultDiskPath,
      resultFileName,
      events: statusEvents(job, 'completed', note ?? '결과 파일 준비 완료')
    });
    res.json(sanitizeJob(updated));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/fail', async (req, res, next) => {
  try {
    const job = await jobStore.getById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job 을 찾을 수 없습니다.' });
    }

    const updated = await jobStore.update(req.params.id, {
      status: 'failed',
      events: statusEvents(job, 'failed', req.body.note ?? 'Colab 처리 실패')
    });
    res.json(sanitizeJob(updated));
  } catch (error) {
    next(error);
  }
});

/**
 * /api/generate-ad
 * 
 * Frontend calls this ONLY when the user clicks "AD 생성" in the editor UI.
 * To avoid excessive Gemini usage, we:
 *   1) Check for an existing JSON file for the given video_id.
 *   2) Only call generate_ad_for_video (Gemini) if no JSON exists.
 * 
 * 크레딧 차감:
 *   - 캐시된 결과 반환 시: 차감 X
 *   - 새로 생성 시: 9.98 크레딧 차감
 * 
 * Expects:
 *   - video_id: Unique identifier for the video
 *   - server_path: Server-side filesystem path to the video file (e.g., storage/uploads/xxxxx.mp4)
 */
app.post('/api/generate-ad', async (req, res, next) => {
  const { video_id, server_path, lang = 'ko', model = 'gemini' } = req.body;
  const authHeader = req.headers.authorization;

  // Log request start
  console.log(`[GenerateAD] /api/generate-ad called. video_id=${video_id}, server_path=${server_path}, lang=${lang}, model=${model}`);

  // Validate request
  if (!video_id || !server_path) {
    console.error('[GenerateAD] Missing required parameters: video_id or server_path');
    return res.status(400).json({
      status: 'error',
      message: 'video_id와 server_path가 필요합니다.'
    });
  }

  // Resolve video path - handle both absolute and relative paths
  let video_path;
  if (path.isAbsolute(server_path)) {
    video_path = server_path;
  } else {
    // If relative, assume it's relative to storage/uploads
    video_path = path.resolve(STORAGE_DIR, server_path);
  }

  console.log(`[GenerateAD] Resolved video path: ${video_path} `);

  // Check if JSON already exists
  // Cache is differentiated by video_id, language, and model
  const jsonPath = path.join(AD_JSON_DIR, `${video_id}_${lang}.ad.json`);
  // Note: We use the same cache file for now regardless of model
  // If you want separate caches per model, use: `${video_id}_${lang}_${model}.ad.json`

  try {
    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const fullData = JSON.parse(jsonContent);

    // Extract segments from full data if it's the new format
    let segments = fullData;
    if (!Array.isArray(fullData) && fullData.audio_descriptions && Array.isArray(fullData.audio_descriptions)) {
      segments = fullData.audio_descriptions;
      // Map to standardized format if needed, but get_AD.py saves it in a way that might need processing?
      // Actually get_AD.py saves the RAW response from Gemini (which has start_time, end_time, description).
      // The frontend expects { id, start, end, text }.
      // We need to map it here if it's the raw format.
      segments = segments.map((seg, idx) => {
        // Helper to parse time string to seconds
        const parseTime = (t) => {
          if (typeof t === 'number') return t;
          if (!t) return 0;
          const parts = String(t).split(':');
          if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
          if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
          return parseFloat(t);
        };

        return {
          id: idx + 1,
          start: parseTime(seg.start_time || seg.start),
          end: parseTime(seg.end_time || seg.end),
          text: seg.description || seg.text || ''
        };
      });
    } else if (Array.isArray(fullData)) {
      // Old format, assume it's already segments or needs mapping
      // If it has start_time/end_time, map it. If start/end, assume it's good.
      if (fullData.length > 0 && (fullData[0].start_time || fullData[0].description)) {
        segments = fullData.map((seg, idx) => {
          const parseTime = (t) => {
            if (typeof t === 'number') return t;
            if (!t) return 0;
            const parts = String(t).split(':');
            if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
            if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
            return parseFloat(t);
          };
          return {
            id: idx + 1,
            start: parseTime(seg.start_time || seg.start),
            end: parseTime(seg.end_time || seg.end),
            text: seg.description || seg.text || ''
          };
        });
      }
    }

    console.log(`[GenerateAD] Found cached JSON: ${jsonPath} `);
    console.log(`[GenerateAD] Returning cached segments: ${segments.length} segments`);
    return res.json({
      status: 'cached',
      segments
    });
  } catch (err) {
    // JSON file doesn't exist, proceed to generate
    if (err.code !== 'ENOENT') {
      console.error('[GenerateAD] Error reading JSON file:', err);
      return res.status(500).json({
        status: 'error',
        message: `JSON 파일 읽기 오류: ${err.message} `
      });
    }
    console.log('[GenerateAD] No cache found. Running generate_ad_for_video()...');
  }

  // Verify video file exists
  try {
    await fs.access(video_path);
    const stats = await fs.stat(video_path);
    console.log(`[GenerateAD] Video file verified: ${video_path} `);
    console.log(`[GenerateAD] Video file size: ${stats.size} bytes`);

    // Verify the file is actually in storage/uploads (security check)
    const normalizedPath = path.normalize(video_path);
    const normalizedUploadDir = path.normalize(UPLOAD_DIR);
    if (!normalizedPath.startsWith(normalizedUploadDir)) {
      console.warn(`[GenerateAD] Warning: Video path is outside storage / uploads: ${video_path} `);
      console.warn(`[GenerateAD] Expected path to start with: ${normalizedUploadDir} `);
    } else {
      console.log(`[GenerateAD] Video path is within storage / uploads(verified)`);
    }
  } catch (err) {
    console.error(`[GenerateAD] Video file not found: ${video_path} `, err);
    return res.status(404).json({
      status: 'error',
      message: `비디오 파일을 찾을 수 없습니다: ${video_path} `
    });
  }

  console.log(`[GenerateAD] AD generation starting: ${video_id}`);
  console.log(`[GenerateAD] Using video path: ${video_path}`);
  console.log(`[GenerateAD] Using model: ${model}`);

  // 크레딧 차감 처리 (로그인한 사용자만)
  let userId = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        userId = user.id;
        
        // 크레딧 차감 시도
        const creditResult = await authRoutes.deductCredits(
          userId,
          authRoutes.CREDIT_COST_AD_GENERATION,
          'ad_generation',
          `AD 생성 (${model})`,
          video_id
        );
        
        if (!creditResult.success) {
          console.log(`[GenerateAD] Credit deduction failed: ${creditResult.error}`);
          return res.status(402).json({
            status: 'error',
            code: 'INSUFFICIENT_CREDITS',
            message: creditResult.error,
            credits: creditResult.credits,
            required: authRoutes.CREDIT_COST_AD_GENERATION
          });
        }
        
        console.log(`[GenerateAD] Credits deducted: ${authRoutes.CREDIT_COST_AD_GENERATION}, remaining: ${creditResult.credits}`);
      }
    } catch (authErr) {
      console.warn('[GenerateAD] Auth check failed, proceeding without credit deduction:', authErr.message);
    }
  } else {
    console.log('[GenerateAD] No auth token, proceeding without credit deduction (guest mode)');
  }

  // Call Python script to generate AD
  return new Promise((resolve, reject) => {
    // Import Python module and call function with logging
    // Escape single quotes in paths for Python string
    const escapedVideoPath = video_path.replace(/\\/g, '/').replace(/'/g, "\\'");
    const escapedPythonPath = PYTHON_SCRIPT_PATH.replace(/\\/g, '/').replace(/'/g, "\\'");
    const escapedOutputDir = AD_JSON_DIR.replace(/\\/g, '/').replace(/'/g, "\\'");
    const escapedLang = lang.replace(/'/g, "\\'");
    const escapedModel = model.replace(/'/g, "\\'");

    // Generate different Python code based on model selection
    let pythonCode;
    
    if (model === 'gpt') {
      // GPT model: Use extract_for_gpt.py + get_AD_gpt.py
      pythonCode = `
import sys
import json
import os
import logging
import traceback
import tempfile
import shutil
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[AD-GPT] %(message)s',
    stream=sys.stderr
)

try:
    sys.path.insert(0, os.path.dirname('${escapedPythonPath}'))
    from extract_for_gpt import process_video_for_gpt
    from get_AD_gpt import generate_ad_from_extracted_data
    
    video_path = '${escapedVideoPath}'
    output_dir = '${escapedOutputDir}'
    lang = '${escapedLang}'
    video_id = '${video_id}'
    
    # Create temporary directory for extracted data
    temp_dir = tempfile.mkdtemp(prefix='gpt_ad_')
    logging.info(f"[AD-GPT] Created temp directory: {temp_dir}")
    
    try:
        # Step 1: Extract data from video (frames + audio analysis)
        logging.info(f"[AD-GPT] Step 1: Extracting data from video...")
        extract_result = process_video_for_gpt(
            input_video=video_path,
            output_dir=temp_dir,
            fps=2.0,
            language=lang,
            whisper_model='base',
            min_silence_duration=0.5
        )
        logging.info(f"[AD-GPT] Extraction complete")
        
        # Find the extracted data directory (video name subfolder)
        video_name = Path(video_path).stem
        data_dir = os.path.join(temp_dir, video_name)
        logging.info(f"[AD-GPT] Data directory: {data_dir}")
        
        # Step 2: Generate AD using GPT
        logging.info(f"[AD-GPT] Step 2: Generating AD with GPT...")
        ad_result = generate_ad_from_extracted_data(
            data_dir=data_dir,
            language=lang,
            min_duration=2.5,
            max_frames_per_segment=10
        )
        
        # Extract segments from result
        segments = []
        if 'audio_descriptions' in ad_result:
            for idx, seg in enumerate(ad_result['audio_descriptions'], start=1):
                # Parse time strings to seconds
                def parse_time(t):
                    if isinstance(t, (int, float)):
                        return float(t)
                    if not t:
                        return 0.0
                    parts = str(t).split(':')
                    if len(parts) == 2:
                        return float(parts[0]) * 60 + float(parts[1])
                    elif len(parts) == 3:
                        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                    return float(t)
                
                segments.append({
                    'id': idx,
                    'start': parse_time(seg.get('start_time', seg.get('start', 0))),
                    'end': parse_time(seg.get('end_time', seg.get('end', 0))),
                    'text': seg.get('description', seg.get('text', ''))
                })
        
        # Save JSON
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f"{video_id}_{lang}.ad.json")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(ad_result, f, ensure_ascii=False, indent=2)
        logging.info(f"[AD-GPT] JSON saved to: {output_path}")
        
        print(json.dumps({
            'success': True,
            'output_path': output_path,
            'segments': segments,
            'model': 'gpt'
        }))
        
    finally:
        # Clean up temp directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            logging.info(f"[AD-GPT] Cleaned up temp directory: {temp_dir}")

except Exception as e:
    logging.error(traceback.format_exc())
    print(json.dumps({
        'success': False,
        'error': str(e),
        'traceback': traceback.format_exc(),
        'model': 'gpt'
    }))
    sys.exit(1)
`;
    } else if (model === 'jack') {
      // Jack Ensemble model: Use get_AD_jack.py (multi-temperature ensemble)
      pythonCode = `
import sys
import json
import os
import logging
import traceback

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[AD-Jack] %(message)s',
    stream=sys.stderr
)

try:
    sys.path.insert(0, os.path.dirname('${escapedPythonPath}'))
    from get_AD_jack import generate_ad_for_video, save_ad_json

    # Generate AD using ensemble approach
    full_data, segments = generate_ad_for_video('${escapedVideoPath}', lang='${escapedLang}')

    # Save JSON
    video_id_param = '${video_id}_${escapedLang}'
    output_path = save_ad_json(video_id_param, full_data, '${escapedOutputDir}')

    print(json.dumps({
        'success': True,
        'output_path': output_path,
        'segments': segments,
        'model': 'jack'
    }))

except Exception as e:
    logging.error(traceback.format_exc())
    print(json.dumps({
        'success': False,
        'error': str(e),
        'traceback': traceback.format_exc(),
        'model': 'jack'
    }))
    sys.exit(1)
`;
    } else {
      // Gemini model (default): Use get_AD_gemini.py (gemini-2.0-flash, no thinking mode)
      pythonCode = `
import sys
import json
import os
import logging
import traceback

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[AD] %(message)s',
    stream=sys.stderr
)

try:
    sys.path.insert(0, os.path.dirname('${escapedPythonPath}'))
    from get_AD_gemini import generate_ad_for_video, save_ad_json

    # Generate AD
    full_data, segments = generate_ad_for_video('${escapedVideoPath}', lang='${escapedLang}')

    # Save JSON
    # video_id for filename: {video_id}_{lang}
    video_id_param = '${video_id}_${escapedLang}'
    output_path = save_ad_json(video_id_param, full_data, '${escapedOutputDir}')

    print(json.dumps({
        'success': True,
        'output_path': output_path,
        'segments': segments,
        'model': 'gemini'
    }))

except Exception as e:
    logging.error(traceback.format_exc())
    print(json.dumps({
        'success': False,
        'error': str(e),
        'traceback': traceback.format_exc(),
        'model': 'gemini'
    }))
    sys.exit(1)
`;
    }

    // Use 'python' on Windows, 'python3' on other platforms
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCmd, ['-c', pythonCode], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      const logLine = data.toString();
      stderr += logLine;
      // Forward Python logs to console
      console.log(`[GenerateAD Python] ${logLine.trim()} `);
    });

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error(`[GenerateAD] Python script exited with code ${code} `);
        console.error(`[GenerateAD] stderr: ${stderr} `);
        console.error(`[GenerateAD] stdout: ${stdout} `);

        // Try to parse error from stdout
        try {
          const errorResult = JSON.parse(stdout.trim());
          if (errorResult.error) {
            // Check for specific error types
            const errorMsg = errorResult.error;
            let statusCode = 500;

            if (errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('overloaded')) {
              statusCode = 503; // Service Unavailable
            } else if (errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
              statusCode = 429; // Too Many Requests
            } else if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
              statusCode = 401; // Unauthorized
            }

            return res.status(statusCode).json({
              status: 'error',
              message: errorMsg,
              code: statusCode === 503 ? 'SERVICE_UNAVAILABLE' :
                statusCode === 429 ? 'RATE_LIMIT' :
                  statusCode === 401 ? 'UNAUTHORIZED' : 'UNKNOWN_ERROR'
            });
          }
        } catch (parseErr) {
          // If parsing fails, return generic error
        }

        // Check stderr for common error patterns
        const errorText = stderr || stdout || '알 수 없는 오류';
        let statusCode = 500;
        if (errorText.includes('503') || errorText.includes('UNAVAILABLE') || errorText.includes('overloaded')) {
          statusCode = 503;
        }

        return res.status(statusCode).json({
          status: 'error',
          message: `AD 생성 실패: ${errorText} `,
          code: statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN_ERROR'
        });
      }

      try {
        // Extract JSON from stdout (may contain other output like progress messages)
        let jsonStr = stdout.trim();
        
        // Find the last JSON object in stdout (in case there are multiple lines or progress messages)
        const jsonMatch = jsonStr.match(/\{[\s\S]*"success"[\s\S]*\}$/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        } else {
          // Try to find any JSON object starting with { and ending with }
          const lastBraceIdx = jsonStr.lastIndexOf('{');
          if (lastBraceIdx !== -1) {
            jsonStr = jsonStr.substring(lastBraceIdx);
          }
        }
        
        const result = JSON.parse(jsonStr);

        if (!result.success) {
          console.error('[GenerateAD] Python script returned error:', result.error);
          if (result.traceback) {
            console.error('[GenerateAD] Python traceback:', result.traceback);
          }

          // Check for specific error types
          const errorMsg = result.error || 'AD 생성 실패';
          let statusCode = 500;
          let errorCode = 'UNKNOWN_ERROR';

          // JSON parsing errors should return 400 (Bad Request)
          if (errorMsg.includes('Failed to parse') ||
            errorMsg.includes('JSON') ||
            errorMsg.includes('json.loads') ||
            errorMsg.includes('JSONDecodeError')) {
            statusCode = 400; // Bad Request
            errorCode = 'JSON_PARSE_ERROR';
          } else if (errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('overloaded')) {
            statusCode = 503; // Service Unavailable
            errorCode = 'SERVICE_UNAVAILABLE';
          } else if (errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
            statusCode = 429; // Too Many Requests
            errorCode = 'RATE_LIMIT';
          } else if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
            statusCode = 401; // Unauthorized
            errorCode = 'UNAUTHORIZED';
          }

          return res.status(statusCode).json({
            status: 'error',
            message: errorMsg,
            code: errorCode
          });
        }

        console.log(`[GenerateAD] AD generation completed: ${video_id} `);
        console.log(`[GenerateAD] Generated ${result.segments.length} segments`);
        console.log(`[GenerateAD] JSON saved to: ${path.join(AD_JSON_DIR, `${video_id}.ad.json`)} `);

        return res.json({
          status: 'generated',
          segments: result.segments
        });
      } catch (parseErr) {
        console.error('[GenerateAD] Failed to parse Python output:', parseErr);
        console.error('[GenerateAD] stdout:', stdout);
        console.error('[GenerateAD] stderr:', stderr);
        return res.status(500).json({
          status: 'error',
          message: 'Python 스크립트 출력을 파싱할 수 없습니다.'
        });
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('[GenerateAD] Failed to start Python process:', err);
      return res.status(500).json({
        status: 'error',
        message: `Python 실행 오류: ${err.message} `
      });
    });
  });
});

app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  console.error('[Error] 서버 오류 발생:', {
    message: err.message,
    stack: err.stack,
    code: err.code,
    path: req.path,
    method: req.method
  });
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: '10GB 이하 파일만 업로드할 수 있습니다.' });
  }
  
  if (err.code === 'ENOENT') {
    return res.status(500).json({ 
      message: '파일 또는 디렉터리를 찾을 수 없습니다.',
      detail: err.message 
    });
  }
  
  if (err.code === 'EACCES') {
    return res.status(500).json({ 
      message: '파일 접근 권한이 없습니다.',
      detail: err.message 
    });
  }
  
  res.status(500).json({ 
    message: err.message || '서버 오류가 발생했습니다.',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

/**
 * POST /api/generate-tts
 * 
 * Generates TTS audio from AD JSON and mixes it with the video.
 * 
 * Expects:
 *   - videoId: Unique identifier for the video
 * 
 * Returns:
 *   - adVideoUrl: URL to AD-mixed video
 *   - adAudioUrl: URL to AD-mixed audio
 */
app.post('/api/generate-tts', async (req, res, next) => {
  const requestId = Date.now().toString(36);
  const { videoId, lang = 'ko', adSegments, voiceProfile = 'gtts', enableDucking = true, geminiApiKey = null } = req.body;
  
  // Gemini API 키 우선순위: 요청 body > 환경변수 (GEMINI_API_KEY 또는 API_KEY_GEMINI)
  const effectiveGeminiApiKey = geminiApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY_GEMINI || null;

  console.log(`[TTS:${requestId}] ========================================`);
  console.log(`[TTS:${requestId}]/api/generate - tts called`);
  console.log(`[TTS:${requestId}] Request body: `, { videoId, lang, hasAdSegments: !!adSegments, adSegmentsCount: adSegments?.length, voiceProfile, enableDucking, hasGeminiApiKey: !!effectiveGeminiApiKey });
  console.log(`[TTS:${requestId}] Current working directory: ${process.cwd()} `);
  console.log(`[TTS:${requestId}]Node.js version: ${process.version} `);
  console.log(`[TTS:${requestId}]Platform: ${process.platform} `);

  // Validate request
  if (!videoId) {
    console.error(`[TTS:${requestId}] Missing videoId parameter`);
    return res.status(400).json({
      status: 'error',
      error: 'TTS_VALIDATION_ERROR',
      code: 'MISSING_VIDEO_ID',
      message: 'videoId가 필요합니다.',
      detail: 'Request body must include videoId field'
    });
  }

  // Resolve paths (absolute)
  const videoPath = path.resolve(UPLOAD_DIR, `${videoId}.mp4`);

  // Determine AD JSON path
  let adJsonPath;
  let usingEditedSegments = false;

  // If adSegments are provided from client, save them to a temporary JSON file
  if (adSegments && Array.isArray(adSegments) && adSegments.length > 0) {
    console.log(`[TTS:${requestId}] Client provided ${adSegments.length} edited AD segments`);
    
    // Create a modified JSON file with the edited segments
    // Use a unique filename to avoid conflicts with original
    adJsonPath = path.resolve(AD_JSON_DIR, `${videoId}_${lang}_edited.ad.json`);
    
    // Convert segments to the format expected by Python TTS script
    // Support both formats: { start, end, text } and { start_time, end_time, description }
    const editedData = {
      audio_descriptions: adSegments.map((seg, idx) => {
        // Extract start time (support both formats)
        const startVal = seg.start ?? seg.start_time ?? 0;
        const endVal = seg.end ?? seg.end_time ?? 0;
        const textVal = seg.text || seg.description || '';
        
        // Parse time strings to numbers if needed
        const parseTime = (t) => {
          if (typeof t === 'number') return t;
          if (!t) return 0;
          const parts = String(t).split(':');
          if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
          if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
          return parseFloat(t) || 0;
        };
        
        const startSec = parseTime(startVal);
        const endSec = parseTime(endVal);
        
        return {
          id: seg.id || idx + 1,
          start: startSec,
          end: endSec,
          text: textVal,
          // Also include aliases for compatibility with Python TTS script
          start_time: startSec,
          end_time: endSec,
          description: textVal,
          duration_sec: Math.max(0, endSec - startSec)
        };
      })
    };

    try {
      await fs.writeFile(adJsonPath, JSON.stringify(editedData, null, 2), 'utf-8');
      console.log(`[TTS:${requestId}] Saved edited segments to: ${adJsonPath}`);
      usingEditedSegments = true;
    } catch (writeErr) {
      console.error(`[TTS:${requestId}] Failed to save edited segments:`, writeErr);
      return res.status(500).json({
        status: 'error',
        error: 'TTS_FILE_ERROR',
        code: 'EDITED_SEGMENTS_SAVE_FAILED',
        message: '수정된 AD 세그먼트를 저장하는 데 실패했습니다.',
        detail: writeErr.message
      });
    }
  } else {
    // No edited segments provided, try to find existing JSON file
    adJsonPath = path.resolve(AD_JSON_DIR, `${videoId}_${lang}.ad.json`);
    try {
      await fs.access(adJsonPath);
      console.log(`[TTS:${requestId}] Found language - specific AD JSON: ${adJsonPath} `);
    } catch (e) {
      // Fallback to generic name
      const fallbackPath = path.resolve(AD_JSON_DIR, `${videoId}.ad.json`);
      try {
        await fs.access(fallbackPath);
        console.log(`[TTS:${requestId}]Language - specific JSON not found, using fallback: ${fallbackPath} `);
        adJsonPath = fallbackPath;
      } catch (e2) {
        // Both failed, keep adJsonPath as the language-specific one for the error message
        console.log(`[TTS:${requestId}] Both language - specific and fallback JSON not found.`);
      }
    }
  }

  console.log(`[TTS:${requestId}] Using AD JSON path: ${adJsonPath} (edited: ${usingEditedSegments})`)

  const ttsScriptPath = path.resolve(TTS_SCRIPT_PATH);
  const ttsOutputDir = path.resolve(TTS_DIR);

  console.log(`[TTS:${requestId}] Resolved paths: `);
  console.log(`[TTS:${requestId}]Video: ${videoPath} `);
  console.log(`[TTS:${requestId}]   AD JSON: ${adJsonPath} `);
  console.log(`[TTS:${requestId}]   TTS Script: ${ttsScriptPath} `);
  console.log(`[TTS:${requestId}]   Output Dir: ${ttsOutputDir} `);
  console.log(`[TTS:${requestId}]Language: ${lang} `);

  // Verify files exist
  try {
    await fs.access(videoPath);
    const videoStats = await fs.stat(videoPath);
    console.log(`[TTS:${requestId}] Video file verified: ${videoPath} (${videoStats.size} bytes)`);
  } catch (err) {
    console.error(`[TTS: ${requestId}]Video file not found: ${videoPath}`);
    console.error(`[TTS:${requestId}]Error: `, err.message);
    return res.status(404).json({
      status: 'error',
      error: 'TTS_FILE_NOT_FOUND',
      code: 'VIDEO_FILE_MISSING',
      message: `비디오 파일을 찾을 수 없습니다: ${videoId} `,
      detail: `Video file not found at: ${videoPath} `
    });
  }

  try {
    await fs.access(adJsonPath);
    const adJsonStats = await fs.stat(adJsonPath);
    console.log(`[TTS:${requestId}] AD JSON file verified: ${adJsonPath} (${adJsonStats.size} bytes)`);
  } catch (err) {
    console.error(`[TTS:${requestId}] AD JSON file not found: ${adJsonPath} `);
    console.error(`[TTS:${requestId}]Error: `, err.message);
    return res.status(404).json({
      status: 'error',
      error: 'TTS_FILE_NOT_FOUND',
      code: 'AD_JSON_MISSING',
      message: `AD JSON 파일을 찾을 수 없습니다: ${videoId} `,
      detail: `AD JSON file not found at: ${adJsonPath} `
    });
  }

  // Verify TTS script exists
  try {
    await fs.access(ttsScriptPath);
    console.log(`[TTS:${requestId}] TTS script verified: ${ttsScriptPath} `);
  } catch (err) {
    console.error(`[TTS:${requestId}] TTS script not found: ${ttsScriptPath} `);
    console.error(`[TTS:${requestId}]Error: `, err.message);
    return res.status(500).json({
      status: 'error',
      error: 'TTS_CONFIGURATION_ERROR',
      code: 'TTS_SCRIPT_MISSING',
      message: 'TTS 스크립트를 찾을 수 없습니다.',
      detail: `TTS script not found at: ${ttsScriptPath} `
    });
  }

  // Ensure TTS output directory exists
  try {
    await fs.mkdir(ttsOutputDir, { recursive: true });
    const outputDirStats = await fs.stat(ttsOutputDir);
    console.log(`[TTS:${requestId}] TTS output directory ready: ${ttsOutputDir} `);
  } catch (err) {
    console.error(`[TTS:${requestId}] Failed to create TTS directory: ${err.message} `);
    console.error(`[TTS:${requestId}] Error stack: `, err.stack);
    return res.status(500).json({
      status: 'error',
      error: 'TTS_DIRECTORY_ERROR',
      code: 'OUTPUT_DIR_CREATION_FAILED',
      message: `TTS 출력 디렉터리 생성 실패: ${err.message} `,
      detail: `Failed to create output directory at: ${ttsOutputDir} `
    });
  }

  // Spawn Python script
  return new Promise((resolve, reject) => {
    // Escape paths for Python string (escape backslashes and single quotes)
    const escapedVideoPath = videoPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedAdJsonPath = adJsonPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedTtsDir = ttsOutputDir.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedTtsScriptPath = ttsScriptPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedLang = lang.replace(/'/g, "\\'");
    const escapedVoiceProfile = (voiceProfile || 'gtts').replace(/'/g, "\\'");
    const duckingEnabled = enableDucking !== false;
    const escapedGeminiApiKey = effectiveGeminiApiKey ? effectiveGeminiApiKey.replace(/'/g, "\\'") : '';

    // Use raw strings for Windows paths to avoid escaping issues
    const pythonCode = `
import sys
import json
import os
import logging
import traceback

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[TTS] %(message)s',
    stream=sys.stderr
)

# Add script directory to path
script_dir = r'${escapedTtsScriptPath}'.replace('/', os.sep).replace('\\\\', os.sep)
script_dir = os.path.dirname(script_dir)
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

logging.info(f"[TTS] Script directory: {script_dir}")
logging.info(f"[TTS] Python executable: {sys.executable}")

try:
    from gemini_json_tts import synthesize_tts_for_video
    logging.info("[TTS] Successfully imported gemini_json_tts module")
except ImportError as import_err:
    logging.error(f"[TTS] Failed to import gemini_json_tts: {import_err}")
    logging.error(f"[TTS] Script directory: {script_dir}")
    logging.error(f"[TTS] Python path: {sys.path}")
    raise

try:
    video_id = '${videoId}'
    # Use raw strings for Windows paths and normalize separators
    video_path = r'${escapedVideoPath}'.replace('/', os.sep).replace('\\\\', os.sep)
    ad_json_path = r'${escapedAdJsonPath}'.replace('/', os.sep).replace('\\\\', os.sep)
    output_dir = r'${escapedTtsDir}'.replace('/', os.sep).replace('\\\\', os.sep)
    lang = '${escapedLang}'
    voice_profile = '${escapedVoiceProfile}'
    enable_ducking = ${duckingEnabled ? 'True' : 'False'}
    gemini_api_key = '${escapedGeminiApiKey}' if '${escapedGeminiApiKey}' else None
    
    # Convert to absolute paths
    video_path = os.path.abspath(video_path)
    ad_json_path = os.path.abspath(ad_json_path)
    output_dir = os.path.abspath(output_dir)

    logging.info(f"[TTS] Starting TTS synthesis for video_id: {video_id}")
    logging.info(f"[TTS] Video path (absolute): {video_path}")
    logging.info(f"[TTS] AD JSON path (absolute): {ad_json_path}")
    logging.info(f"[TTS] Output dir (absolute): {output_dir}")
    logging.info(f"[TTS] Language: {lang}")
    logging.info(f"[TTS] Voice Profile: {voice_profile}")
    logging.info(f"[TTS] Ducking Enabled: {enable_ducking}")
    logging.info(f"[TTS] Gemini API Key: {'설정됨' if gemini_api_key else '환경변수 사용'}")
    
    # Verify files exist before proceeding
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not os.path.exists(ad_json_path):
        raise FileNotFoundError(f"AD JSON file not found: {ad_json_path}")

    result = synthesize_tts_for_video(
        video_id=video_id,
        video_path=video_path,
        ad_json_path=ad_json_path,
        output_dir=output_dir,
        lang=lang,
        voice_profile=voice_profile,
        enable_ducking=enable_ducking,
        gemini_api_key=gemini_api_key
    )
    
    # Verify result has required fields
    if not result.get('finalVideoPath') or not result.get('finalAudioPath'):
        raise ValueError(f"TTS synthesis result missing required fields: {result}")

    print(json.dumps(result, ensure_ascii=False))

except Exception as e:
    logging.error(traceback.format_exc())
    error_info = {
        'success': False,
        'error': str(e),
        'error_type': type(e).__name__,
        'traceback': traceback.format_exc()
    }
    print(json.dumps(error_info, ensure_ascii=False))
    sys.exit(1)
`;

    // Determine Python interpreter path
    // Priority: PYTHON_TTS_EXECUTABLE env var > PYTHON_PATH env var > 'python'
    const pythonPath = process.env.PYTHON_TTS_EXECUTABLE || process.env.PYTHON_PATH || 'python';

    console.log(`[TTS:${requestId}] Python configuration: `);
    console.log(`[TTS:${requestId}]PYTHON_TTS_EXECUTABLE: ${process.env.PYTHON_TTS_EXECUTABLE || '(not set)'} `);
    console.log(`[TTS:${requestId}]PYTHON_PATH: ${process.env.PYTHON_PATH || '(not set)'} `);
    console.log(`[TTS:${requestId}]   Selected Python: ${pythonPath} `);

    // Verify Python executable exists (on Windows, this helps catch common issues)
    if (process.platform === 'win32') {
      try {
        // Try to resolve the path
        const { execSync } = require('child_process');
        const pythonVersion = execSync(`"${pythonPath}" --version`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        console.log(`[TTS:${requestId}] Python version check: ${pythonVersion} `);
      } catch (checkErr) {
        console.error(`[TTS:${requestId}] Python executable check failed: `, checkErr.message);
        console.error(`[TTS:${requestId}] This may indicate Python is not found at: ${pythonPath} `);
        console.error(`[TTS:${requestId}] Please set PYTHON_TTS_EXECUTABLE environment variable to the full path of python.exe`);
        return res.status(500).json({
          status: 'error',
          error: 'TTS_CONFIGURATION_ERROR',
          code: 'PYTHON_EXECUTABLE_NOT_FOUND',
          message: `Python 실행 파일을 찾을 수 없습니다: ${pythonPath} `,
          detail: `Python executable not found or not accessible.Error: ${checkErr.message}. Please set PYTHON_TTS_EXECUTABLE environment variable.`
        });
      }
    }

    console.log(`[TTS:${requestId}] Spawning Python process...`);
    console.log(`[TTS:${requestId}]Command: ${pythonPath} -c < inline_code > `);
    console.log(`[TTS:${requestId}] Video path(absolute): ${videoPath} `);
    console.log(`[TTS:${requestId}] AD JSON path(absolute): ${adJsonPath} `);
    console.log(`[TTS:${requestId}] Output dir(absolute): ${ttsOutputDir} `);
    console.log(`[TTS:${requestId}] TTS script path(absolute): ${ttsScriptPath} `);

    // Ensure PATH is properly set for Python process to find ffmpeg
    // On Windows, we need to explicitly include the PATH from the current process
    // Also add common FFmpeg installation paths
    const currentPath = process.env.PATH || process.env.Path || '';
    const ffmpegCommonPath = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft', 'WinGet', 'Packages',
      'Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'ffmpeg-8.0-essentials_build', 'bin'
    );

    // Build PATH with FFmpeg location if it exists
    let enhancedPath = currentPath;
    try {
      if (fsSync.existsSync(ffmpegCommonPath)) {
        if (!enhancedPath.includes(ffmpegCommonPath)) {
          enhancedPath = `${ffmpegCommonPath};${enhancedPath} `;
          console.log(`[TTS:${requestId}] Added FFmpeg path to environment: ${ffmpegCommonPath} `);
        }
      }
    } catch (pathErr) {
      console.warn(`[TTS:${requestId}] Could not check FFmpeg path: ${pathErr.message} `);
    }

    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PATH: enhancedPath,
      Path: enhancedPath // Windows uses both PATH and Path
    };

    console.log(`[TTS:${requestId}] Environment PATH(first 500 chars): ${enhancedPath.substring(0, 500)} `);

    const pythonProcess = spawn(pythonPath, ['-c', pythonCode], {
      env: env,
      cwd: path.dirname(ttsScriptPath) // Set working directory to Python script directory
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      const logLine = data.toString();
      stderr += logLine;
      // Forward Python logs to console
      console.log(`[TTS Python] ${logLine.trim()} `);
    });

    pythonProcess.on('close', async (code) => {
      console.log(`[TTS:${requestId}] Python process exited with code: ${code} `);

      if (code !== 0) {
        console.error(`[TTS:${requestId}] ========== TTS FAILURE ==========`);
        console.error(`[TTS:${requestId}] Exit code: ${code} `);
        console.error(`[TTS:${requestId}] stdout length: ${stdout.length} chars`);
        console.error(`[TTS:${requestId}] stderr length: ${stderr.length} chars`);
        console.error(`[TTS:${requestId}]stdout(first 2000 chars): `, stdout.substring(0, 2000));
        console.error(`[TTS:${requestId}]stderr(first 2000 chars): `, stderr.substring(0, 2000));
        console.error(`[TTS:${requestId}] ================================= `);

        // Try to parse error from stdout (Python script may have returned JSON error)
        let errorCode = 'TTS_PYTHON_ERROR';
        let errorMessage = 'TTS 생성 실패';
        let errorDetail = stderr || stdout || '알 수 없는 오류';

        try {
          const errorResult = JSON.parse(stdout.trim());
          if (errorResult.error) {
            errorMessage = errorResult.error;
            errorDetail = errorResult.traceback || errorResult.error;

            // Detect specific error types
            if (errorMessage.includes('WinError 2') || errorMessage.includes('cannot find the file')) {
              errorCode = 'TTS_FILE_NOT_FOUND';
              errorMessage = '파일을 찾을 수 없습니다. Python 실행 파일, ffmpeg, 또는 입력 파일 경로를 확인해주세요.';
            } else if (errorMessage.includes('ModuleNotFoundError') || errorMessage.includes('No module named')) {
              errorCode = 'TTS_MODULE_NOT_FOUND';
              errorMessage = 'Python 모듈을 찾을 수 없습니다. requirements.txt의 패키지를 설치해주세요.';
            } else if (errorMessage.includes('audioop') || errorMessage.includes('pyaudioop')) {
              errorCode = 'TTS_AUDIOOP_ERROR';
              errorMessage = 'audioop 모듈 오류. Python 3.13을 사용하는 경우 audioop-lts를 설치해주세요: pip install audioop-lts';
            } else if (errorMessage.includes('ffmpeg') || errorMessage.includes('FFmpeg')) {
              errorCode = 'TTS_FFMPEG_ERROR';
              errorMessage = 'ffmpeg를 찾을 수 없습니다. 시스템에 ffmpeg를 설치하고 PATH에 추가해주세요.';
            }
          }
        } catch (parseErr) {
          // If parsing fails, analyze stderr for common patterns
          if (stderr.includes('WinError 2') || stderr.includes('cannot find the file')) {
            errorCode = 'TTS_FILE_NOT_FOUND';
            errorMessage = '파일을 찾을 수 없습니다. Python 실행 파일 또는 스크립트 경로를 확인해주세요.';
            errorDetail = stderr;
          } else if (stderr.includes('ModuleNotFoundError') || stderr.includes('No module named')) {
            errorCode = 'TTS_MODULE_NOT_FOUND';
            errorMessage = 'Python 모듈을 찾을 수 없습니다.';
            errorDetail = stderr;
          }
        }

        return res.status(500).json({
          status: 'error',
          error: 'TTS_BACKEND_ERROR',
          code: errorCode,
          message: errorMessage,
          detail: errorDetail.substring(0, 2000), // Limit detail length
          pythonExitCode: code,
          pythonStdout: stdout.substring(0, 1000),
          pythonStderr: stderr.substring(0, 1000)
        });
      }

      try {
        const result = JSON.parse(stdout.trim());

        // Verify result structure
        if (!result.finalVideoPath || !result.finalAudioPath) {
          console.error(`[TTS:${requestId}] Invalid result structure: `, result);
          return res.status(500).json({
            status: 'error',
            error: 'TTS_INVALID_RESULT',
            code: 'MISSING_OUTPUT_PATHS',
            message: 'TTS 생성 결과가 올바르지 않습니다.',
            detail: `Result missing finalVideoPath or finalAudioPath.Result: ${JSON.stringify(result)} `
          });
        }

        const finalVideoPath = result.finalVideoPath;
        const finalAudioPath = result.finalAudioPath;

        // Verify output files exist
        try {
          await fs.access(finalVideoPath);
          await fs.access(finalAudioPath);
          const videoStats = await fs.stat(finalVideoPath);
          const audioStats = await fs.stat(finalAudioPath);
          console.log(`[TTS:${requestId}] Output files verified: `);
          console.log(`[TTS:${requestId}]Video: ${finalVideoPath} (${videoStats.size} bytes)`);
          console.log(`[TTS:${requestId}]Audio: ${finalAudioPath} (${audioStats.size} bytes)`);
        } catch (fileErr) {
          console.error(`[TTS:${requestId}] Output files not found: `, fileErr.message);
          return res.status(500).json({
            status: 'error',
            error: 'TTS_OUTPUT_MISSING',
            code: 'OUTPUT_FILES_NOT_FOUND',
            message: 'TTS 생성된 파일을 찾을 수 없습니다.',
            detail: `Output files not found.Video: ${finalVideoPath}, Audio: ${finalAudioPath} `
          });
        }

        // Map generated segment clip metadata (if available)
        const rawSegments = Array.isArray(result.segmentOutputs)
          ? result.segmentOutputs
          : Array.isArray(result.segments)
            ? result.segments
            : [];

        const segmentClips = rawSegments.map((seg, idx) => {
          const start = Number(seg.start_time ?? seg.start ?? 0);
          const end = Number(seg.end_time ?? seg.end ?? start);
          const durationMs = Number(seg.duration_ms ?? seg.durationMs ?? Math.max(0, (end - start) * 1000));
          const description = seg.description ?? seg.text ?? '';
          const wavPath = seg.wav_path ?? seg.wavPath ?? seg.audio_path ?? seg.audioPath;

          let audioRelativePath = '';
          let audioUrl = '';
          if (wavPath) {
            const normalized = path.resolve(wavPath);
            audioRelativePath = path.relative(TTS_DIR, normalized);
            audioUrl = `/static/tts/${audioRelativePath.replace(/\\+/g, '/')}`;
          } else if (seg.relative_path || seg.relativePath) {
            audioRelativePath = (seg.relative_path ?? seg.relativePath) || '';
            audioUrl = `/static/tts/${audioRelativePath.replace(/\\+/g, '/')}`;
          }

          return {
            id: seg.index ?? seg.id ?? idx + 1,
            start,
            end,
            durationMs,
            text: description,
            audioRelativePath,
            audioUrl
          };
        });

        // Generate URLs relative to /static/tts
        const adVideoFile = path.basename(finalVideoPath);
        const adAudioFile = path.basename(finalAudioPath);

        const adVideoUrl = `/static/tts/${adVideoFile}`;
        const adAudioUrl = `/static/tts/${adAudioFile}`;

        console.log(`[TTS:${requestId}] ========== TTS SUCCESS ==========`);
        console.log(`[TTS:${requestId}] Video ID: ${videoId}`);
        console.log(`[TTS:${requestId}] Video URL: ${adVideoUrl}`);
        console.log(`[TTS:${requestId}] Audio URL: ${adAudioUrl}`);
        console.log(`[TTS:${requestId}] Segment clips: ${segmentClips.length}`);
        console.log(`[TTS:${requestId}] Used segments: ${result.usedSegments}`);
        console.log(`[TTS:${requestId}] Cut segments: ${result.cutSegments}`);
        console.log(`[TTS:${requestId}] =================================`);

        return res.json({
          status: 'ok',
          videoId,
          adVideoUrl,
          adAudioUrl,
          adVideoPath: finalVideoPath,
          adAudioPath: finalAudioPath,
          segmentClips,
          meta: {
            usedSegments: result.usedSegments,
            cutSegments: result.cutSegments
          }
        });
      } catch (parseErr) {
        console.error(`[TTS:${requestId}] Failed to parse Python stdout as JSON: `, parseErr);
        console.error(`[TTS:${requestId}] Parse error stack: `, parseErr.stack);
        console.error(`[TTS:${requestId}]stdout(first 2000 chars): `, stdout.substring(0, 2000));
        return res.status(500).json({
          status: 'error',
          error: 'TTS_PARSE_ERROR',
          code: 'JSON_PARSE_FAILED',
          message: 'TTS 결과 파싱 실패',
          detail: `Failed to parse Python output as JSON: ${parseErr.message}.Output: ${stdout.substring(0, 500)} `
        });
      }
    });

    pythonProcess.on('error', (err) => {
      console.error(`[TTS:${requestId}] ========== PYTHON SPAWN ERROR ==========`);
      console.error(`[TTS:${requestId}] Failed to start Python process: `, err);
      console.error(`[TTS:${requestId}] Error code: `, err.code);
      console.error(`[TTS:${requestId}] Error message: `, err.message);
      console.error(`[TTS:${requestId}] Error stack: `, err.stack);
      console.error(`[TTS:${requestId}] Python path attempted: `, pythonPath);
      console.error(`[TTS:${requestId}] ========================================= `);

      let errorCode = 'PYTHON_SPAWN_ERROR';
      let errorMessage = `Python 실행 오류: ${err.message} `;

      if (err.code === 'ENOENT') {
        errorCode = 'PYTHON_NOT_FOUND';
        errorMessage = `Python 실행 파일을 찾을 수 없습니다: ${pythonPath} `;
      }

      return res.status(500).json({
        status: 'error',
        error: 'TTS_CONFIGURATION_ERROR',
        code: errorCode,
        message: errorMessage,
        detail: `Failed to spawn Python process.Python path: ${pythonPath}.Error: ${err.message}. Please set PYTHON_TTS_EXECUTABLE environment variable to the full path of python.exe`
      });
    });
  });
});

/**
 * 평가 정보 JSON 파일 경로 생성 헬퍼
 * @param {string} videoId - 비디오 ID
 * @param {string} version - 버전 ('original' | 'edited')
 * @returns {string} - JSON 파일 경로
 */
function getRatingsFilePath(videoId, version = 'original') {
  const suffix = version === 'edited' ? '_edited' : '';
  return path.join(RATINGS_DIR, `${videoId}${suffix}_ratings.json`);
}

/**
 * 평가 정보 로드 헬퍼
 * @param {string} videoId - 비디오 ID
 * @param {string} version - 버전 ('original' | 'edited')
 * @returns {Promise<object|null>} - 평가 정보 객체 또는 null
 */
async function loadRatings(videoId, version = 'original') {
  const filePath = getRatingsFilePath(videoId, version);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * 평가 정보 저장 헬퍼
 * @param {string} videoId - 비디오 ID
 * @param {object} ratingsData - 평가 정보 객체
 * @param {string} version - 버전 ('original' | 'edited')
 */
async function saveRatings(videoId, ratingsData, version = 'original') {
  const filePath = getRatingsFilePath(videoId, version);
  await fs.mkdir(RATINGS_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(ratingsData, null, 2), 'utf-8');
  console.log(`[Ratings] Saved ratings to: ${filePath}`);
}

/**
 * GET /api/ratings/:videoId
 * 
 * 특정 비디오의 평가 정보를 조회합니다.
 * 
 * Query params:
 *   - version: 'original' | 'edited' (기본값: 'original')
 * 
 * Returns:
 *   - 평가 정보 객체 또는 404
 */
app.get('/api/ratings/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { version = 'original' } = req.query;

  console.log(`[Ratings] GET /api/ratings/${videoId}?version=${version}`);

  try {
    const ratings = await loadRatings(videoId, version);
    
    if (!ratings) {
      return res.status(404).json({
        status: 'not_found',
        message: '평가 정보를 찾을 수 없습니다.',
        videoId,
        version
      });
    }

    return res.json({
      status: 'ok',
      videoId,
      version,
      data: ratings
    });
  } catch (err) {
    console.error(`[Ratings] Error loading ratings:`, err);
    return res.status(500).json({
      status: 'error',
      message: `평가 정보 로드 실패: ${err.message}`
    });
  }
});

/**
 * POST /api/ratings/:videoId
 * 
 * 특정 비디오의 평가 정보를 생성하거나 전체 업데이트합니다.
 * 
 * Body:
 *   - videoInfo: { fileName, duration, width, height }
 *   - segments: [{ id, start, end, text, rating }] // rating: 'like' | 'dislike' | 'neutral'
 *   - version: 'original' | 'edited' (기본값: 'original')
 * 
 * Returns:
 *   - 저장된 평가 정보
 */
app.post('/api/ratings/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { videoInfo, segments, version = 'original' } = req.body;

  console.log(`[Ratings] POST /api/ratings/${videoId}?version=${version}`);
  console.log(`[Ratings] Segments count: ${segments?.length || 0}`);

  if (!segments || !Array.isArray(segments)) {
    return res.status(400).json({
      status: 'error',
      message: 'segments 배열이 필요합니다.'
    });
  }

  try {
    const ratingsData = {
      videoId,
      videoInfo: videoInfo || {},
      segments: segments.map(seg => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text || '',
        rating: seg.rating || 'neutral' // 'like' | 'dislike' | 'neutral'
      })),
      version,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await saveRatings(videoId, ratingsData, version);

    return res.json({
      status: 'ok',
      message: '평가 정보가 저장되었습니다.',
      videoId,
      version,
      data: ratingsData
    });
  } catch (err) {
    console.error(`[Ratings] Error saving ratings:`, err);
    return res.status(500).json({
      status: 'error',
      message: `평가 정보 저장 실패: ${err.message}`
    });
  }
});

/**
 * PATCH /api/ratings/:videoId/segment/:segmentId
 * 
 * 특정 세그먼트의 평가만 업데이트합니다.
 * 
 * Body:
 *   - rating: 'like' | 'dislike' | 'neutral'
 *   - version: 'original' | 'edited' (기본값: 'original')
 * 
 * Returns:
 *   - 업데이트된 세그먼트 정보
 */
app.patch('/api/ratings/:videoId/segment/:segmentId', async (req, res) => {
  const { videoId, segmentId } = req.params;
  const { rating, version = 'original' } = req.body;

  console.log(`[Ratings] PATCH /api/ratings/${videoId}/segment/${segmentId}`);
  console.log(`[Ratings] New rating: ${rating}, version: ${version}`);

  if (!rating || !['like', 'dislike', 'neutral'].includes(rating)) {
    return res.status(400).json({
      status: 'error',
      message: "rating은 'like', 'dislike', 'neutral' 중 하나여야 합니다."
    });
  }

  try {
    let ratingsData = await loadRatings(videoId, version);
    
    if (!ratingsData) {
      return res.status(404).json({
        status: 'not_found',
        message: '평가 정보를 찾을 수 없습니다. 먼저 POST /api/ratings/:videoId로 초기화해주세요.',
        videoId,
        version
      });
    }

    // 해당 세그먼트 찾아서 업데이트
    const segmentIndex = ratingsData.segments.findIndex(
      seg => String(seg.id) === String(segmentId)
    );

    if (segmentIndex === -1) {
      return res.status(404).json({
        status: 'not_found',
        message: `세그먼트 ID ${segmentId}를 찾을 수 없습니다.`,
        videoId,
        segmentId
      });
    }

    ratingsData.segments[segmentIndex].rating = rating;
    ratingsData.updatedAt = new Date().toISOString();

    await saveRatings(videoId, ratingsData, version);

    return res.json({
      status: 'ok',
      message: '평가가 업데이트되었습니다.',
      videoId,
      segmentId,
      rating,
      segment: ratingsData.segments[segmentIndex]
    });
  } catch (err) {
    console.error(`[Ratings] Error updating segment rating:`, err);
    return res.status(500).json({
      status: 'error',
      message: `평가 업데이트 실패: ${err.message}`
    });
  }
});

/**
 * POST /api/ratings/:videoId/apply-edits
 * 
 * 편집 적용 시 호출됩니다.
 * - 원본 JSON의 편집된 세그먼트에 'dislike' 적용
 * - 편집된 버전의 새 JSON 생성 (편집된 세그먼트에 'like' 적용)
 * 
 * Body:
 *   - originalSegments: [{ id, start, end, text }] - 편집 전 세그먼트
 *   - editedSegments: [{ id, start, end, text }] - 편집 후 세그먼트
 *   - editedSegmentIds: [id, ...] - 편집된 세그먼트 ID 목록
 *   - videoInfo: { fileName, duration, width, height }
 * 
 * Returns:
 *   - 원본 및 편집 버전 평가 정보
 */
app.post('/api/ratings/:videoId/apply-edits', async (req, res) => {
  const { videoId } = req.params;
  const { originalSegments, editedSegments, editedSegmentIds = [], videoInfo } = req.body;

  console.log(`[Ratings] POST /api/ratings/${videoId}/apply-edits`);
  console.log(`[Ratings] Original segments: ${originalSegments?.length || 0}`);
  console.log(`[Ratings] Edited segments: ${editedSegments?.length || 0}`);
  console.log(`[Ratings] Edited segment IDs: ${editedSegmentIds}`);

  if (!originalSegments || !editedSegments) {
    return res.status(400).json({
      status: 'error',
      message: 'originalSegments와 editedSegments가 필요합니다.'
    });
  }

  try {
    // 1. 원본 버전 로드 또는 생성
    let originalRatings = await loadRatings(videoId, 'original');
    
    if (!originalRatings) {
      // 원본 평가 정보가 없으면 생성
      originalRatings = {
        videoId,
        videoInfo: videoInfo || {},
        segments: originalSegments.map(seg => ({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          text: seg.text || '',
          rating: 'neutral'
        })),
        version: 'original',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    // 2. 원본 버전에서 편집된 세그먼트에 'dislike' 적용
    const editedIdSet = new Set(editedSegmentIds.map(id => String(id)));
    originalRatings.segments = originalRatings.segments.map(seg => {
      if (editedIdSet.has(String(seg.id))) {
        return { ...seg, rating: 'dislike' };
      }
      return seg;
    });
    originalRatings.updatedAt = new Date().toISOString();

    // 3. 편집 버전 생성 - 편집된 세그먼트에 'like' 적용
    const editedRatings = {
      videoId,
      videoInfo: videoInfo || {},
      segments: editedSegments.map(seg => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text || '',
        rating: editedIdSet.has(String(seg.id)) ? 'like' : 'neutral'
      })),
      version: 'edited',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 4. 양쪽 버전 저장
    await saveRatings(videoId, originalRatings, 'original');
    await saveRatings(videoId, editedRatings, 'edited');

    return res.json({
      status: 'ok',
      message: '편집 적용 평가 정보가 저장되었습니다.',
      videoId,
      original: originalRatings,
      edited: editedRatings
    });
  } catch (err) {
    console.error(`[Ratings] Error applying edits:`, err);
    return res.status(500).json({
      status: 'error',
      message: `편집 적용 실패: ${err.message}`
    });
  }
});

/**
 * POST /api/export-with-ad
 *
 * Renders a final video that includes the AD audio mix and provides a downloadable URL.
 */
app.post('/api/export-with-ad', async (req, res) => {
  const requestId = Date.now().toString(36);
  const { videoId, serverPath, adSegments = [], options = {} } = req.body || {};

  console.log(`[Export:${requestId}] ========================================`);
  console.log(`[Export:${requestId}] Request body:`, { videoId, serverPath, adSegments: adSegments.length });

  if (!videoId) {
    return res.status(400).json({
      status: 'error',
      error: 'EXPORT_VALIDATION_ERROR',
      code: 'MISSING_VIDEO_ID',
      message: 'videoId가 필요합니다.',
      detail: 'Request body must include videoId field'
    });
  }

  let sourceVideoPath = serverPath ? path.resolve(serverPath) : null;

  if (sourceVideoPath && !(await pathExists(sourceVideoPath))) {
    console.warn(`[Export:${requestId}] Provided serverPath not found: ${sourceVideoPath}`);
    sourceVideoPath = null;
  }

  if (!sourceVideoPath) {
    const defaultCandidate = path.join(UPLOAD_DIR, `${videoId}.mp4`);
    if (await pathExists(defaultCandidate)) {
      sourceVideoPath = defaultCandidate;
    } else {
      // Try to find file by scanning uploads directory
      try {
        const uploadFiles = await fs.readdir(UPLOAD_DIR);
        const match = uploadFiles.find((fileName) => fileName.startsWith(videoId));
        if (match) {
          sourceVideoPath = path.join(UPLOAD_DIR, match);
        }
      } catch (scanError) {
        console.warn(`[Export:${requestId}] Failed to scan upload directory: ${scanError.message}`);
      }
    }
  }

  if (!sourceVideoPath) {
    console.error(`[Export:${requestId}] Unable to locate source video for videoId=${videoId}`);
    return res.status(404).json({
      status: 'error',
      error: 'EXPORT_FILE_NOT_FOUND',
      code: 'VIDEO_FILE_MISSING',
      message: `비디오 파일을 찾을 수 없습니다: ${videoId}`,
      detail: '업로드된 비디오를 찾을 수 없습니다. 먼저 비디오를 업로드하거나 serverPath를 전달해주세요.'
    });
  }

  const ttsAudioPath = path.join(TTS_DIR, `${videoId}_ad_mix.wav`);
  const ttsVideoPath = path.join(TTS_DIR, `${videoId}_ad_mix.mp4`);

  const hasTtsAudio = await pathExists(ttsAudioPath);
  const hasTtsVideo = await pathExists(ttsVideoPath);

  if (!hasTtsAudio && !hasTtsVideo) {
    console.error(`[Export:${requestId}] No TTS outputs found for videoId=${videoId}`);
    return res.status(400).json({
      status: 'error',
      error: 'EXPORT_TTS_MISSING',
      code: 'TTS_OUTPUT_MISSING',
      message: 'TTS 결과가 없습니다. 먼저 "TTS 변환"을 실행해주세요.',
      detail: 'storage/tts 디렉터리에서 AD 오디오/비디오를 찾을 수 없습니다.'
    });
  }

  try {
    await fs.mkdir(EXPORT_DIR, { recursive: true });
  } catch (err) {
    console.error(`[Export:${requestId}] Failed to ensure export directory:`, err);
    return res.status(500).json({
      status: 'error',
      error: 'EXPORT_DIRECTORY_ERROR',
      code: 'EXPORT_DIR_CREATION_FAILED',
      message: 'Export 디렉터리를 생성할 수 없습니다.',
      detail: err.message
    });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportFileName = `${videoId}_ad_export_${timestamp}.mp4`;
  const exportPath = path.join(EXPORT_DIR, exportFileName);

  console.log(`[Export:${requestId}] Source video: ${sourceVideoPath}`);
  console.log(`[Export:${requestId}] Using TTS audio: ${hasTtsAudio ? ttsAudioPath : 'N/A'}`);
  console.log(`[Export:${requestId}] Using TTS video fallback: ${hasTtsVideo && !hasTtsAudio ? ttsVideoPath : 'N/A'}`);

  try {
    if (hasTtsAudio) {
      // Combine original video stream with AD-mixed audio
      await mergeVideoWithAudio({
        videoPath: sourceVideoPath,
        audioPath: ttsAudioPath,
        outputPath: exportPath,
        requestId
      });
    } else {
      // Fallback: copy the already mixed video file
      await fs.copyFile(ttsVideoPath, exportPath);
      console.log(`[Export:${requestId}] Copied existing AD video to export path`);
    }
  } catch (err) {
    console.error(`[Export:${requestId}] Failed to render export video:`, err);
    return res.status(500).json({
      status: 'error',
      error: 'EXPORT_RENDER_ERROR',
      code: 'FFMPEG_FAILURE',
      message: '비디오 렌더링 중 오류가 발생했습니다.',
      detail: err.stderr ? err.stderr.substring(0, 2000) : err.message
    });
  }

  let exportStats = null;
  try {
    exportStats = await fs.stat(exportPath);
  } catch (err) {
    console.error(`[Export:${requestId}] Failed to stat export file:`, err);
  }

  const downloadUrl = `/static/exports/${encodeURIComponent(exportFileName)}`;

  console.log(`[Export:${requestId}] Export completed. downloadUrl=${downloadUrl}`);

  return res.json({
    status: 'ok',
    videoId,
    downloadUrl,
    fileName: exportFileName,
    meta: {
      fileSize: exportStats ? exportStats.size : null,
      adSegments: adSegments.length,
      mixOptions: options,
      audioMixSource: hasTtsAudio ? 'ad_mix_wav' : 'ad_mix_video'
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`API server listening on http://localhost:${PORT}`);
  console.log(`Upload endpoint: POST http://localhost:${PORT}/api/upload`);
  console.log(`Health check: GET http://localhost:${PORT}/api/health`);
  console.log(`Server timeout: 30 minutes (for long-running AD/TTS operations)`);
  console.log(`Max file size: 10GB`);
  console.log(`========================================`);
});

// Set server timeout for long-running requests (30 minutes)
// AD generation for long videos can take 15-20+ minutes
server.timeout = 1800000;  // 30 minutes
server.keepAliveTimeout = 120000;  // 2 minutes
server.headersTimeout = 1810000;  // slightly more than timeout

