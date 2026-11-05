import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fail, safePath } from './core.js';

const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 800 * 1024 * 1024;
const MAX_FILE_BYTES = 90 * 1024 * 1024;

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    percent: job.percent,
    message: job.message,
    ...(job.result ? { result: job.result } : {}),
  };
}

async function walkFiles(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(root, path));
    else if (entry.isFile()) found.push(path);
    else fail(400, 'ZIP 안의 특수 파일은 업로드할 수 없습니다.');
  }
  return found;
}

function progress(job, percent, message) {
  job.percent = Math.max(0, Math.min(100, Math.floor(percent)));
  job.message = message;
  job.updatedAt = Date.now();
}

export class EluriJobs {
  constructor(github, config) {
    this.github = github;
    this.config = config;
    this.jobs = new Map();
    this.activeId = null;
  }

  forUser(userId) {
    const jobs = [...this.jobs.values()].filter(job => job.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
    return jobs[0] ? publicJob(jobs[0]) : null;
  }

  get(userId, id) {
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId) fail(404, '작업을 찾을 수 없습니다.');
    return publicJob(job);
  }

  start(userId) {
    if (!this.config.ELURI_SCRIPT_PATH) fail(503, '프로그램설정.txt에 ELURI_SCRIPT_PATH를 설정해주세요.');
    if (this.activeId) {
      const active = this.jobs.get(this.activeId);
      if (active && active.status === 'running') fail(409, 'e-루리 수집 작업이 이미 진행 중입니다.');
      this.activeId = null;
    }
    const scriptPath = resolve(this.config.ELURI_SCRIPT_PATH);
    const id = randomUUID();
    const job = { id, userId, status: 'running', percent: 0, message: '수집 작업을 준비하고 있습니다.', createdAt: Date.now(), updatedAt: Date.now() };
    this.jobs.set(id, job);
    this.activeId = id;
    void this.run(job, scriptPath);
    return publicJob(job);
  }

  async run(job, scriptPath) {
    let archivePath = '';
    let stderr = '';
    try {
      progress(job, 1, '서버 PC에서 e-루리 브라우저를 여는 중입니다.');
      const usePyLauncher = process.platform === 'win32' && !this.config.ELURI_PYTHON;
      const command = this.config.ELURI_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
      const args = [...(usePyLauncher ? ['-3'] : []), scriptPath];
      const profileId = createHash('sha256').update(job.userId).digest('hex');
      const profilePath = resolve(this.config.ELURI_PROFILE_DIR || 'data/eluri-profiles', profileId);
      const child = spawn(command, args, {
        cwd: dirname(scriptPath),
        env: { ...process.env, ELURI_MANAGED: '1', ELURI_PROFILE_PATH: profilePath, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('ELURI_PROGRESS ')) continue;
          try {
            const event = JSON.parse(line.slice('ELURI_PROGRESS '.length));
            if (event.archive) archivePath = String(event.archive);
            progress(job, Math.min(64, Number(event.percent) || 0), String(event.message || 'e-루리 처리 중입니다.').slice(0, 240));
          } catch { /* Ignore malformed progress lines. */ }
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      await new Promise((resolveExit, rejectExit) => {
        child.once('error', rejectExit);
        child.once('close', code => code === 0 ? resolveExit() : rejectExit(new Error(this.pythonError(stderr, code))));
      });
      if (!archivePath) fail(500, 'e-루리 프로그램이 ZIP 저장 경로를 알려주지 않았습니다.');
      const allowedRoot = resolve(dirname(scriptPath), 'e-luri-downloads') + sep;
      const resolvedArchive = resolve(archivePath);
      if (!resolvedArchive.startsWith(allowedRoot) || basename(resolvedArchive).toLowerCase().endsWith('.zip') === false) {
        fail(400, '다운로드 파일 경로가 설정된 폴더와 다릅니다.');
      }
      await stat(resolvedArchive);
      job.archivePath = resolvedArchive;
      const result = await this.uploadZip(job, resolvedArchive);
      job.status = 'done';
      job.result = result;
      progress(job, 100, `${result.fileCount}개 과제 파일을 GitHub에 올렸습니다.`);
    } catch (error) {
      job.status = 'failed';
      progress(job, job.percent, error?.message || 'e-루리 작업에 실패했습니다.');
    } finally {
      if (this.activeId === job.id) this.activeId = null;
    }
  }

  pythonError(stderr, code) {
    const text = String(stderr || '').split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    if (/No module named ['"]?playwright/i.test(text)) return 'Python Playwright가 설치되지 않았습니다. Python 환경에 playwright와 Chromium을 설치해주세요.';
    return text ? `e-루리 수집 프로그램이 종료되었습니다: ${text.slice(-500)}` : `e-루리 수집 프로그램이 오류 코드 ${code}로 종료되었습니다.`;
  }

  async uploadZip(job, zipPath) {
    const temporary = await mkdtemp(join(tmpdir(), 'euris-eluri-'));
    try {
      const extractor = resolve('scripts/extract-eluri-zip.py');
      const usePyLauncher = process.platform === 'win32' && !this.config.ELURI_PYTHON;
      const command = this.config.ELURI_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
      const args = [...(usePyLauncher ? ['-3'] : []), extractor, zipPath, temporary];
      const extracted = await new Promise((resolveOutput, rejectOutput) => {
        const child = spawn(command, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', error = '';
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { output = (output + chunk).slice(-1000); });
        child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
        child.once('error', rejectOutput);
        child.once('close', code => code === 0 ? resolveOutput(output.trim()) : rejectOutput(new Error(error.trim() || `ZIP 압축 해제에 실패했습니다 (${code}).`)));
      });
      const [declaredCount, declaredBytes] = extracted.split('\t').map(Number);
      if (!Number.isSafeInteger(declaredCount) || !Number.isSafeInteger(declaredBytes) || declaredCount < 1 || declaredCount > MAX_FILES || declaredBytes > MAX_TOTAL_BYTES) {
        fail(413, '업로드할 과제 파일 수 또는 전체 용량이 한도를 넘었습니다.');
      }
      const files = await walkFiles(temporary);
      if (files.length !== declaredCount) fail(400, '압축 파일의 목록이 일치하지 않습니다.');

      progress(job, 66, `압축을 풀었습니다. ${files.length}개 파일을 GitHub에 올립니다.`);
      const owned = await this.github.ensureEuris(job.userId);
      if (!owned.repo.private) fail(403, 'euris 저장소가 공개 상태입니다. 비공개 저장소로 바꾼 뒤 다시 시도해주세요.');
      const accessible = (await this.github.repositories(job.userId)).find(repo => repo.fullName.toLowerCase() === owned.repo.full_name.toLowerCase());
      if (!accessible) fail(403, 'GitHub 앱이 euris 저장소에 설치되어 있지 않습니다. 저장소 접근 설정에서 앱을 추가해주세요.');

      const repo = { fullName: accessible.fullName, branch: accessible.branch };
      const snapshot = await this.github.snapshot(job.userId, repo, repo.branch);
      const root = snapshot.root;
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const prefix = `e-luri/${timestamp}`;
      const entries = [];
      let bytesRead = 0;
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const info = await stat(filePath);
        if (info.size > MAX_FILE_BYTES) fail(413, `GitHub 단일 파일 한도 때문에 업로드할 수 없습니다: ${basename(filePath)}`);
        bytesRead += info.size;
        if (bytesRead > MAX_TOTAL_BYTES) fail(413, '전체 업로드 용량이 한도를 넘었습니다.');
        const relativePath = relative(temporary, filePath).split(sep).join('/');
        const githubPath = safePath(`${prefix}/${relativePath}`);
        const blob = await this.github.request(job.userId, 'POST', root + '/git/blobs', { content: (await readFile(filePath)).toString('base64'), encoding: 'base64' });
        entries.push({ path: githubPath, mode: '100644', type: 'blob', sha: blob.sha });
        progress(job, 66 + Math.floor(((i + 1) / files.length) * 28), `GitHub에 파일을 올리는 중입니다 (${i + 1}/${files.length}).`);
      }

      const newTree = await this.github.request(job.userId, 'POST', root + '/git/trees', { base_tree: snapshot.treeSha, tree: entries });
      const commit = await this.github.request(job.userId, 'POST', root + '/git/commits', {
        message: `e-루리 과제 업로드 ${timestamp}`,
        tree: newTree.sha,
        parents: [snapshot.head],
      });
      const latest = await this.github.snapshot(job.userId, repo, repo.branch);
      if (latest.head !== snapshot.head) fail(409, '업로드 중 GitHub 저장소가 변경되었습니다. 다시 실행해주세요.');
      await this.github.request(job.userId, 'PATCH', `${root}/git/refs/heads/${encodeURIComponent(repo.branch)}`, { sha: commit.sha, force: false });
      progress(job, 98, 'GitHub 저장소에 커밋했습니다.');
      return {
        fileCount: files.length,
        bytes: bytesRead,
        repository: repo.fullName,
        url: `https://github.com/${repo.fullName}/commit/${commit.sha}`,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
