const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeFilename(name, maxLength = 80) {
  const cleaned = name
    .replace(ILLEGAL_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim() || '_unnamed';

  if (cleaned.length <= maxLength) return cleaned;

  // Truncate while preserving the file extension, if any
  const extMatch = cleaned.match(/(\.\w{1,8})$/);
  const ext = extMatch ? extMatch[1] : '';
  const base = ext ? cleaned.slice(0, -ext.length) : cleaned;
  return base.slice(0, maxLength - ext.length) + ext;
}

// Derives a filename from the topic title + URL extension
// e.g. title="Lecture Notes", url="/content/.../lecture.pdf" → "Lecture Notes.pdf"
export function deriveFilename(title, url) {
  const ext = url.match(/\.(\w{2,5})(?:\?|#|$)/)?.[1];
  if (ext && !title.toLowerCase().endsWith(`.${ext}`)) {
    return `${title}.${ext}`;
  }
  return title;
}

// Sanitizes each segment of a '/'-separated folder path, preserving the nesting structure
export function sanitizeFolderPath(path, fallback = 'BrightspaceExport') {
  const segments = path.split('/').map(s => s.trim()).filter(Boolean).map(s => sanitizeFilename(s));
  return segments.length ? segments.join('/') : fallback;
}

const VIDEO_PATTERNS = [/panopto/i, /youtube\.com/i, /youtu\.be/i, /kaltura/i, /mediasite/i];

export function isVideoLink(topic) {
  return topic.TypeIdentifier === 'Link' &&
    VIDEO_PATTERNS.some(p => p.test(topic.Url || ''));
}

// Produces a standalone HTML file listing video links
export function generateVideoLinksHTML(videos) {
  if (!videos.length) return null;
  const items = videos
    .map(v => `  <li><a href="${escapeHtml(v.url)}" target="_blank">${escapeHtml(v.title)}</a></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Video Links</title>
  <style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;line-height:1.6}a{color:#1a73e8}</style>
</head>
<body>
  <h1>Video Links</h1>
  <ul>
${items}
  </ul>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Recursively walks a TOC module tree and returns two arrays:
// files: [{ title, url, path: ['Module', 'Submodule'] }]
// videos: [{ title, url }]
export function extractFromTOC(modules, path = []) {
  const files = [];
  const videos = [];

  for (const mod of modules || []) {
    const modPath = [...path, mod.Title];

    for (const topic of mod.Topics || []) {
      if (topic.TypeIdentifier === 'File') {
        files.push({ title: topic.Title, url: topic.Url, path: modPath });
      } else if (isVideoLink(topic)) {
        videos.push({ title: topic.Title, url: topic.Url });
      }
    }

    const nested = extractFromTOC(mod.Modules, modPath);
    files.push(...nested.files);
    videos.push(...nested.videos);
  }

  return { files, videos };
}
