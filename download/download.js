import { BrightspaceAPI, APIError } from '../src/brightspace-api.js';
import {
  extractFromTOC, generateVideoLinksHTML, sanitizeFilename, sanitizeFolderPath, deriveFilename,
} from '../src/file-writer.js';

async function chromeDownload(blob, filePath) {
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url, filename: filePath, conflictAction: 'overwrite', saveAs: false },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (downloadId === undefined) {
            reject(new Error('Download did not start'));
            return;
          }
          function onChanged(delta) {
            if (delta.id !== downloadId) return;
            if (delta.state?.current === 'complete') {
              chrome.downloads.onChanged.removeListener(onChanged);
              resolve();
            } else if (delta.state?.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(onChanged);
              reject(new Error(delta.error?.current || 'Download interrupted'));
            }
          }
          chrome.downloads.onChanged.addListener(onChanged);
        }
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function textToBlob(text) {
  return new Blob([text], { type: 'text/html' });
}

async function loadJob() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('job');
  if (!jobId) return null;
  const result = await chrome.storage.session.get(jobId);
  return result[jobId] || null;
}

function makeState(job) {
  return {
    courses: Object.fromEntries(
      job.courses.map(c => [c.orgUnitId, {
        name: c.name,
        categories: {
          content:     { total: 0, done: 0 },
          assignments: { total: 0, done: 0 },
          videos:      { total: 0, done: 0 },
        },
      }])
    ),
    overall: { total: 0, done: 0 },
    log: [],
    failed: [],
    skipped: [],
    startTime: Date.now(),
  };
}

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function buildCourseDom(orgUnitId, courseName, contentTypes, progressDetail) {
  const block = document.createElement('div');
  block.className = 'course-block';
  block.id = `course-${orgUnitId}`;

  const nameEl = document.createElement('div');
  nameEl.className = 'course-name';
  nameEl.textContent = courseName;
  block.appendChild(nameEl);

  if (progressDetail === 'per-category') {
    const labels = { content: 'Content', assignments: 'Assignments', videos: 'Videos' };
    for (const cat of ['content', 'assignments', 'videos']) {
      if (!contentTypes.includes(cat)) continue;
      block.insertAdjacentHTML('beforeend', `
        <div class="category-row">
          <span class="category-label">${labels[cat]}</span>
          <div class="bar-wrap"><div class="bar" id="bar-${orgUnitId}-${cat}"></div></div>
          <span class="category-count" id="count-${orgUnitId}-${cat}">0 / 0</span>
        </div>
      `);
    }
  }

  block.insertAdjacentHTML('beforeend', `
    <div class="current-file" id="current-${orgUnitId}"></div>
  `);

  document.getElementById('course-blocks').appendChild(block);
}

function updateCategoryProgress(orgUnitId, cat, done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barEl = document.getElementById(`bar-${orgUnitId}-${cat}`);
  const countEl = document.getElementById(`count-${orgUnitId}-${cat}`);
  if (barEl) barEl.style.width = `${pct}%`;
  if (countEl) countEl.textContent = `${done} / ${total}`;
}

function updateOverall(state) {
  const { done, total } = state.overall;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  setText('overall-label', `Overall: ${done} / ${total} files`);
  const barEl = document.getElementById('overall-bar');
  if (barEl) barEl.style.width = `${pct}%`;

  if (done > 1 && total > done) {
    const elapsed = (Date.now() - state.startTime) / 1000;
    const rate = done / elapsed;
    const remaining = Math.ceil((total - done) / rate);
    setText('eta-label', `~${remaining}s remaining`);
  }
}

function appendLog(entry) {
  const log = document.getElementById('log');
  const line = document.createElement('div');
  const cls = { done: 'log-done', skip: 'log-skip', fail: 'log-fail', current: 'log-current' }[entry.status];
  const icon = { done: '✓', skip: '–', fail: '✗', current: '⬇' }[entry.status];
  line.className = cls;
  line.textContent = `${icon} ${entry.path}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function downloadFile({ api, filePath, filename, url, logPath, state, orgUnitId, cat }) {
  setText(`current-${orgUnitId}`, filename);
  appendLog({ status: 'current', path: logPath });

  try {
    const blob = await withRetry(() => api.downloadBlob(url));
    await chromeDownload(blob, filePath);
    state.overall.done++;
    state.courses[orgUnitId].categories[cat].done++;
    appendLog({ status: 'done', path: logPath });
  } catch (err) {
    state.failed.push(`${logPath} — ${err.message}`);
    state.overall.done++;
    appendLog({ status: 'fail', path: `${logPath} (${err.message})` });
  }

  updateCategoryProgress(
    orgUnitId, cat,
    state.courses[orgUnitId].categories[cat].done,
    state.courses[orgUnitId].categories[cat].total,
  );
  updateOverall(state);
}

async function downloadContent(course, courseBasePath, api, state, contentTypes) {
  const toc = await api.getContentTOC(course.orgUnitId);
  const { files, videos } = extractFromTOC(toc.Modules);
  const cat = state.courses[course.orgUnitId].categories;
  const wantContent = contentTypes.includes('content');
  const wantVideos = contentTypes.includes('videos');

  if (wantContent) {
    cat.content.total = files.length;
    state.overall.total += files.length;
    updateCategoryProgress(course.orgUnitId, 'content', 0, files.length);
  }
  if (wantVideos && videos.length > 0) {
    cat.videos.total = 1;
    state.overall.total += 1;
  }

  if (wantContent) {
    for (const file of files) {
      const sanitizedSegments = file.path.map(s => sanitizeFilename(s));
      const rawFilename = deriveFilename(file.title, file.url);
      const filename = sanitizeFilename(rawFilename);
      const logPath = `Content/${file.path.join('/')}/${rawFilename}`;
      const filePath = [courseBasePath, 'Content', ...sanitizedSegments, filename].join('/');
      await downloadFile({ api, filePath, filename, url: file.url, logPath, state, orgUnitId: course.orgUnitId, cat: 'content' });
    }
  }

  if (wantVideos && videos.length > 0) {
    const html = generateVideoLinksHTML(videos);
    const filePath = [courseBasePath, 'Videos', 'video-links.html'].join('/');
    await chromeDownload(textToBlob(html), filePath);
    state.overall.done++;
    cat.videos.done = 1;
    updateCategoryProgress(course.orgUnitId, 'videos', 1, 1);
    updateOverall(state);
    appendLog({ status: 'done', path: 'Videos/video-links.html' });
  }
}

async function downloadAssignments(course, courseBasePath, api, state) {
  const folders = await api.getAssignmentFolders(course.orgUnitId);
  const cat = state.courses[course.orgUnitId].categories;

  // 1 instructions.html per folder + attachments
  const totalFiles = folders.reduce((sum, f) => sum + 1 + f.attachments.length, 0);
  cat.assignments.total = totalFiles;
  state.overall.total += totalFiles;
  updateCategoryProgress(course.orgUnitId, 'assignments', 0, totalFiles);

  for (const folder of folders) {
    const folderName = sanitizeFilename(folder.name);
    const folderBasePath = [courseBasePath, 'Assignments', folderName].join('/');

    const instructionsHtml = folder.instructions
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${sanitizeFilename(folder.name)}</title></head><body>${folder.instructions}</body></html>`
      : '<p>No instructions provided.</p>';
    await chromeDownload(textToBlob(instructionsHtml), `${folderBasePath}/instructions.html`);
    state.overall.done++;
    cat.assignments.done++;
    updateCategoryProgress(course.orgUnitId, 'assignments', cat.assignments.done, cat.assignments.total);
    updateOverall(state);
    appendLog({ status: 'done', path: `Assignments/${folder.name}/instructions.html` });

    for (const att of folder.attachments) {
      const url = api.assignmentAttachmentUrl(course.orgUnitId, folder.id, att.fileId);
      const logPath = `Assignments/${folder.name}/${att.fileName}`;
      const filePath = `${folderBasePath}/${sanitizeFilename(att.fileName)}`;
      await downloadFile({ api, filePath, filename: att.fileName, url, logPath, state, orgUnitId: course.orgUnitId, cat: 'assignments' });
    }
  }
}

async function runDownload(job) {
  const api = new BrightspaceAPI(job.institutionUrl);
  const state = makeState(job);

  job.courses.forEach(c =>
    buildCourseDom(c.orgUnitId, c.name, job.contentTypes, job.progressDetail)
  );

  for (const course of job.courses) {
    const courseBasePath = `${job.exportFolderName}/${sanitizeFilename(course.name)}`;

    try {
      if (job.contentTypes.includes('content') || job.contentTypes.includes('videos')) {
        await downloadContent(course, courseBasePath, api, state, job.contentTypes);
      }
      if (job.contentTypes.includes('assignments')) {
        await downloadAssignments(course, courseBasePath, api, state);
      }
    } catch (err) {
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
        showAuthError(job.institutionUrl);
        return;
      }
      appendLog({ status: 'fail', path: `[${course.name}] unexpected error: ${err.message}` });
      state.failed.push(`[${course.name}] ${err.message}`);
    }
  }

  showSummary(state);
}

function showAuthError(institutionUrl) {
  hide('progress-screen');
  show('error-screen');
  setText('error-message', 'Your Brightspace session has expired. Please log in again and retry.');
  document.getElementById('error-link').href = `https://${institutionUrl}`;
}

function showSummary(state) {
  hide('progress-screen');
  show('summary-screen');
  const doneCount = state.overall.done - state.failed.length - state.skipped.length;
  setText('stat-done', Math.max(0, doneCount));
  setText('stat-skip', state.skipped.length);
  setText('stat-fail', state.failed.length);
  if (state.failed.length > 0) {
    document.getElementById('failed-section').style.display = '';
    document.getElementById('failed-list').textContent = state.failed.join('\n');
  }
}

async function main() {
  const job = await loadJob();
  if (!job) {
    hide('pick-screen');
    show('error-screen');
    setText('error-message', 'No download job found. Please start from the extension popup.');
    document.getElementById('error-link').style.display = 'none';
    return;
  }

  const folderInput = document.getElementById('export-folder');
  folderInput.value = job.exportFolderName;

  document.getElementById('start-btn').addEventListener('click', async () => {
    job.exportFolderName = sanitizeFolderPath(folderInput.value, job.exportFolderName);
    hide('pick-screen');
    show('progress-screen');
    await runDownload(job);
  });
}

main();
