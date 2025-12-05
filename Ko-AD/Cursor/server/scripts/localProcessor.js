/* eslint-disable no-console */
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || API_BASE_URL.replace(/\/api$/, '');
const STORAGE_DIR = path.resolve(__dirname, '..', 'storage');
const RESULT_DIR = path.join(STORAGE_DIR, 'results');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const PROCESSOR_SCRIPT =
  process.env.PROCESSOR_SCRIPT || path.resolve(__dirname, 'resize_480p.py');

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const message = await res.text();
    throw new Error(`Request failed ${res.status}: ${message}`);
  }
  return res.json();
}

async function runResize(inputPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [PROCESSOR_SCRIPT, '--input', inputPath, '--output', outputPath, '--height', '480'];
    const proc = spawn(PYTHON_BIN, args, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit'
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Python processor exited with code ${code}`));
      }
    });
  });
}

async function processJob(job) {
  console.log(`Job ${job.id} 처리 시작`);

  await fetchJSON(`${API_BASE_URL}/jobs/${job.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'processing', note: '로컬 변환 준비' })
  });

  const sourceUrl = new URL(job.sourceUrl, SERVER_BASE_URL).href;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`원본 다운로드 실패: ${response.status}`);
  }

  await fs.mkdir(RESULT_DIR, { recursive: true });

  const arrayBuffer = await response.arrayBuffer();
  const sourceBuffer = Buffer.from(arrayBuffer);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ad-mixer-'));
  const safeName = job.sourceStoredName || job.sourceFileName || `${job.id}.mp4`;
  const sourceTmpPath = path.join(tmpDir, safeName);
  await fs.writeFile(sourceTmpPath, sourceBuffer);

  const targetName = `${path.parse(job.sourceFileName).name}_480p.mp4`;
  const targetRelativePath = path.posix.join('results', targetName);
  const targetDiskPath = path.join(STORAGE_DIR, targetRelativePath);

  await fetchJSON(`${API_BASE_URL}/jobs/${job.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'generating', note: '480p 변환 중' })
  });

  await runResize(sourceTmpPath, targetDiskPath);

  await fetchJSON(`${API_BASE_URL}/jobs/${job.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'rendering', note: '결과 파일 저장 중' })
  });

  await fs.rm(tmpDir, { recursive: true, force: true });

  await fetchJSON(`${API_BASE_URL}/jobs/${job.id}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resultFileName: targetName,
      resultRelativePath: targetRelativePath,
      note: '480p 변환 완료'
    })
  });

  console.log(`Job ${job.id} 완료: ${targetRelativePath}`);
}

async function main() {
  try {
    const job = await fetchJSON(`${API_BASE_URL}/jobs/next`);
    if (!job) {
      console.log('대기 중인 작업이 없습니다.');
      return;
    }
    await processJob(job);
  } catch (error) {
    console.error('로컬 파이프라인 오류', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

main();

