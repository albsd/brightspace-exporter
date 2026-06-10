# Brightspace Exporter

Browser extension (Firefox & Chrome) for downloading course materials from a
D2L Brightspace instance into a structured local folder.

## Features

- Detects the current course when you open the popup on a Brightspace page,
  with an option to add more courses from your enrollments
- Download course content, assignments, and a list of video links
- Files are saved under `Downloads/<export folder>/<Course Name>/...`
- Progress tab with per-category and overall progress bars, live log, and
  a final summary (downloaded / skipped / failed)

## Installation (development)

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on" and select `manifest.json`

### Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder

## Settings

Open the extension's options page to configure:

- **Brightspace URL** — hostname of your institution's Brightspace instance
- **Progress detail** — per-category or overall-only progress bars
- **Default content types** — pre-checked types in the popup
- **Export folder** — subfolder path created inside your browser's Downloads
  folder (browser extensions cannot save outside of it)

## Project structure

```
manifest.json
popup/        extension popup UI
settings/     options page
download/     download tab (progress UI + download logic)
src/          shared modules (API client, settings store, file naming)
icons/        extension icons
```
