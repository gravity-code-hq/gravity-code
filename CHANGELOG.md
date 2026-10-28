# Changelog

## 0.8.5 - 2026-10-27

### Added

- Find text in file diffs with match case, whole word, and regular expression options
- Optional follow-up prompt suggestions in the composer, configurable in host settings
- PDF previews in the file pane with zoom controls and fit-to-width viewing
- Discard changes buttons on file and folder rows in the diff view
- Option to exclude hidden files from workspace content searches

### Changed

- Cmd/Ctrl+N opens a new agent; Cmd/Ctrl+Alt+N opens a new workspace
- The file explorer hides dotfiles by default
- Tool call hover previews wait longer before opening

### Fixed

- Unwanted workspace content search matches from Git metadata and system files

## 0.8.4 - 2026-10-16

### Added

- Sentry plugin example for browsing issues, inspecting stack traces, and starting an agent to investigate or fix a bug
- Wide plugin dialogs and support for opening links in your browser

### Changed

- Closing an agent tab keeps its conversation available and remembers the closed tab after restarting
- The inbox digest automation starts enabled on fresh setups
- Updated addition and deletion colors in file diffs

### Fixed

- Claude conversation rewind with custom configuration directories and unanswered turns
- Claude context meter limits for custom models and usage reported late
- Background Claude subagent labels after streaming and daemon restarts
- Codex approval handling for repeated callbacks and declined commands
- Codex rewind on older versions and preservation of custom provider settings
- Missing file changes with custom Git diff settings, renamed files, or subdirectory workspaces
- New branches inheriting an upstream that could send their first push to main
- Directory searches timing out or blocking other searches
- Daemon startup with stale PID files and crashes when log output cannot be written
- Daemon memory growth after sessions close and excess watcher work in ignored directories
- Stalled encrypted relay connections remaining open indefinitely

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
