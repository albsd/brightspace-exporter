import { getSettings, saveSettings, getDefaults } from '../src/settings-store.js';
import { sanitizeFolderPath } from '../src/file-writer.js';

async function load() {
  const s = await getSettings();
  document.getElementById('institutionUrl').value = s.institutionUrl;
  document.getElementById('progressDetail').value = s.progressDetail;
  document.getElementById('exportFolderName').value = s.exportFolderName;
  ['content', 'assignments', 'videos'].forEach(t => {
    document.getElementById(`type-${t}`).checked = s.defaultContentTypes.includes(t);
  });
}

document.getElementById('save-btn').addEventListener('click', async () => {
  const defaultContentTypes = ['content', 'assignments', 'videos'].filter(t =>
    document.getElementById(`type-${t}`).checked
  );

  await saveSettings({
    institutionUrl: document.getElementById('institutionUrl').value.trim().replace(/^https?:\/\//, ''),
    progressDetail: document.getElementById('progressDetail').value,
    exportFolderName: sanitizeFolderPath(document.getElementById('exportFolderName').value, getDefaults().exportFolderName),
    defaultContentTypes,
  });

  await load();

  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

load();
