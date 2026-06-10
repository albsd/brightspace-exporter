const DEFAULTS = {
  institutionUrl: 'brightspace.tudelft.nl',
  progressDetail: 'per-category',      // 'per-category' | 'overall'
  defaultContentTypes: ['content', 'assignments', 'videos'],
  exportFolderName: 'BrightspaceExport', // subfolder path under the browser's Downloads directory
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  await chrome.storage.sync.set(partial);
}

export function getDefaults() {
  return { ...DEFAULTS };
}
