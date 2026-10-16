# Changelog

## 0.8.3 - 2026-10-12

### Added

- Workspace search: find files by name or search their contents, with match case, whole word, regex, and include/exclude filters
- Find and replace in the file editor
- MCP servers tab in Claude Code and Codex settings showing each server's status and how to connect more
- Automations (formerly Schedules) gain a runs table, filters, and prompt templates
- Queued messages in the composer
- New agent button on sidebar workspace rows

### Changed

- The desktop app keeps your computer from idle-sleeping while a local agent is working

## 0.8.2 - 2026-10-08

### Added

- Gravity for Linux as a `.deb` package for Ubuntu, Debian, and Mint (x64)
- The download page picks the build for your platform and keeps the other one a click away
- Rename and archive conversations from the sidebar, with a confirmation when the agent is still running
- Caffeine mode: keep a Mac working with the lid closed, globally in Settings → General or per agent from the composer
- Text size zoom for the editor and terminal, with a desktop View menu entry
- Separate terminal text size setting
- Context budget option for Claude Code and Codex agents to set when automatic compaction kicks in

### Changed

- Collapsed the composer's agent controls into one settings menu with the mode control
- Terminal text defaults to 15 px
- Desktop release builds no longer run out of memory on CI

## 0.8.1 - 2026-10-01

- Gravity for Apple Silicon Macs is now signed and notarized by Apple. It opens without the Privacy & Security prompt, and future versions update automatically.
- Provider customizations and improved workspace controls.
- Fixed agent drafts crashing on duplicate catalog choices, duplicate workspaces and agents on retries, and out-of-memory errors from long tool histories.
- Fixed Android clipboard image pasting and the Android tablet model picker.
- Faster cold diffs and wrapped text measurement.

## 0.8.0 - 2026-09-22

First Gravity release.
