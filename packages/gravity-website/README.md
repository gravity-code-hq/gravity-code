# Gravity website

Gravity’s standalone marketing and download frontend. Run it from the repository root:

```bash
npm run dev:gravity
```

Open the URL printed by Vite (normally `http://localhost:3000`). This website does not start the desktop app or daemon.

```bash
npm run build:gravity
npm run preview --workspace=@gravity/website
```

Deploy `packages/gravity-website/dist` to a static host. Each page is its own HTML file (`index.html`, `download/started/index.html`), so no routing rewrites are needed. Fonts and their license notices are served locally.

## Publish the desktop downloads

Download buttons open `/download/started/?platform=<id>`, which starts the download and shows install steps for that platform. The links are hard-coded in `src/releases.ts` to fixed-name assets on the public `gravity-code-hq/gravity` repo:

| Platform             | Asset                                              |
| -------------------- | -------------------------------------------------- |
| macOS, Apple Silicon | `releases/latest/download/gravity-macos-arm64.dmg` |
| Linux, x64           | `releases/latest/download/gravity-linux-x64.deb`   |

Every desktop release uploads these fixed-name copies next to the versioned artifacts (`.github/workflows/desktop-release.yml`), so new releases need no site change. The site picks the default from the browser's user agent: Linux visitors get the `.deb`, everyone else gets the DMG, and the other platform stays one click away on the card. Windows is marked as coming later; Intel Macs are not supported.

The links are not environment variables because Vercel refuses `VITE_`-prefixed values under its sensitive-variable policy. `VITE_GRAVITY_VERSION` is optional and only labels the download card. No installer is bundled in the website or downloaded during its build.

The interactive workspace is an illustrative product preview with three selectable example tasks. It never connects to a daemon or executes agents.
