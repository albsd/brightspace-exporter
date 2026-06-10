import { getSettings } from '../src/settings-store.js';
import { BrightspaceAPI } from '../src/brightspace-api.js';

let detectedCourse = null;     // { orgUnitId, name }
let extraCourses = [];         // [{ orgUnitId, name }] from picker
let allEnrollments = [];       // full list, loaded lazily

async function init() {
  const settings = await getSettings();
  const api = new BrightspaceAPI(settings.institutionUrl);

  settings.defaultContentTypes.forEach(t => {
    const el = document.getElementById(`type-${t}`);
    if (el) el.checked = true;
  });

  // Settings link — direct navigation is more reliable than openOptionsPage()
  document.getElementById('settings-link').href =
    chrome.runtime.getURL('settings/settings.html');
  document.getElementById('settings-link').target = '_blank';

  await detectCourse(api);

  const expandBtn = document.getElementById('expand-btn');
  const courseList = document.getElementById('course-list');
  expandBtn.addEventListener('click', async () => {
    expandBtn.classList.toggle('open');
    courseList.classList.toggle('open');
    if (courseList.classList.contains('open') && allEnrollments.length === 0) {
      await loadEnrollments(api);
    }
  });

  document.getElementById('download-btn').addEventListener('click', () => startDownload());
  updateDownloadBtn();
}

async function detectCourse(api) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const [{ result: orgUnitId }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const url = window.location.href;
        const patterns = [
          /\/d2l\/home\/(\d+)/,
          /\/d2l\/le\/content\/(\d+)/,
          /\/d2l\/lms\/\S+[?&]ou=(\d+)/,
          /[?&]ou=(\d+)/,
        ];
        for (const p of patterns) {
          const m = url.match(p);
          if (m) return m[1];
        }
        return null;
      },
    });

    if (!orgUnitId) return;

    const settings = await getSettings();
    const freshApi = new BrightspaceAPI(settings.institutionUrl);
    const enrollments = await freshApi.getEnrollments();
    const course = enrollments.find(e => e.orgUnitId === orgUnitId);
    if (!course) return;

    detectedCourse = course;
    const el = document.getElementById('detected-course');
    el.textContent = course.name;
    el.classList.remove('none');
    updateDownloadBtn();
  } catch (err) {
    const errEl = document.getElementById('course-error');
    errEl.textContent = `Detection failed: ${err.message}`;
    errEl.style.display = '';
  }
}

async function loadEnrollments(api) {
  const loading = document.getElementById('courses-loading');
  const courseList = document.getElementById('course-list');
  try {
    allEnrollments = await api.getEnrollments();
    loading.remove();

    allEnrollments.forEach(course => {
      const label = document.createElement('label');
      label.className = 'course-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = course.orgUnitId;
      // Pre-check and lock if it's the detected course
      if (detectedCourse?.orgUnitId === course.orgUnitId) {
        cb.checked = true;
        cb.disabled = true;
      }
      cb.addEventListener('change', () => {
        if (cb.checked) {
          extraCourses.push(course);
        } else {
          extraCourses = extraCourses.filter(c => c.orgUnitId !== course.orgUnitId);
        }
        updateDownloadBtn();
      });
      label.append(cb, document.createTextNode(course.name));
      courseList.appendChild(label);
    });
  } catch (err) {
    loading.textContent = 'Failed to load courses. Are you logged in?';
  }
}

function getSelectedCourses() {
  const courses = detectedCourse ? [detectedCourse] : [];
  extraCourses.forEach(c => {
    if (!courses.find(x => x.orgUnitId === c.orgUnitId)) courses.push(c);
  });
  return courses;
}

function getSelectedContentTypes() {
  return ['content', 'assignments', 'videos'].filter(t =>
    document.getElementById(`type-${t}`)?.checked
  );
}

function updateDownloadBtn() {
  const btn = document.getElementById('download-btn');
  btn.disabled = getSelectedCourses().length === 0 || getSelectedContentTypes().length === 0;
}

['content', 'assignments', 'videos'].forEach(t => {
  document.getElementById(`type-${t}`)?.addEventListener('change', updateDownloadBtn);
});

async function startDownload() {
  const courses = getSelectedCourses();
  const contentTypes = getSelectedContentTypes();
  if (!courses.length || !contentTypes.length) return;

  const jobId = `job-${Date.now()}`;
  const settings = await getSettings();

  await chrome.storage.session.set({
    [jobId]: {
      courses,
      contentTypes,
      institutionUrl: settings.institutionUrl,
      progressDetail: settings.progressDetail,
      exportFolderName: settings.exportFolderName,
    },
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`download/download.html?job=${jobId}`),
  });

  window.close();
}

init();
