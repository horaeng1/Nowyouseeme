const fs = require('fs/promises');
const path = require('path');

class JobStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async init() {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify([]));
    }
  }

  async read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      if (!raw || raw.trim() === '') {
        return [];
      }
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 파일이 없으면 빈 배열 반환
        return [];
      }
      if (error instanceof SyntaxError) {
        // JSON 파싱 오류 시 빈 배열로 초기화
        console.error('[JobStore] JSON 파싱 오류, 파일 초기화:', this.filePath);
        await this.write([]);
        return [];
      }
      throw error;
    }
  }

  async write(data) {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[JobStore] 파일 쓰기 오류:', error);
      throw error;
    }
  }

  async add(job) {
    const jobs = await this.read();
    jobs.push(job);
    await this.write(jobs);
    return job;
  }

  async update(id, updater) {
    const jobs = await this.read();
    const idx = jobs.findIndex((job) => job.id === id);
    if (idx === -1) {
      throw new Error(`Job(${id}) not found`);
    }

    const nextJob = { ...jobs[idx], ...updater, updatedAt: new Date().toISOString() };
    jobs[idx] = nextJob;
    await this.write(jobs);
    return nextJob;
  }

  async getById(id) {
    const jobs = await this.read();
    return jobs.find((job) => job.id === id) ?? null;
  }

  async findByStatus(status) {
    const jobs = await this.read();
    return jobs.filter((job) => job.status === status);
  }

  async all() {
    return this.read();
  }
}

module.exports = JobStore;

