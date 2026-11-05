Nano — by VANTA

Build the installer: double-click "Build Nano Setup.vbs" (Windows). Needs internet the first time.
Run from source: npm install, then npm start.

Shortcuts: Ctrl+T new tab, Ctrl+W close, Ctrl+L address bar, Ctrl+R / F5 reload,
Ctrl+Tab next tab, Ctrl+1-9 jump to tab, Alt+Left/Right back/forward.

Nano Brain: Nano's own on-device AI (brain.js). It writes the AI overview on Nano Seek and powers the
chat pinned on the new tab page (also reachable by typing nano://chat in the address bar).

Nano AI: chat has a model selector. Nano NEURA 1 lite (~1.1 GB) and Nano NEURA 1 (~2.1 GB) download inside the app on first use (no build step,
no API key). 'Nano AI (search)' needs no download. Memory is saved per Nano account (or Guest). Say "remember that ..." in chat to add to it.
Build once: Build Nano Setup.vbs (or the GitHub Action in .github/workflows) -> one small installer, Nano-Setup.exe.

Default browser: Nano registers itself on Windows (Default apps), macOS and Linux. On first launch it offers to become the default; links from other apps open in a new Nano tab.
Build per OS: Windows -> Build Nano Setup.vbs; macOS/Linux -> npm run dist on that OS (or the GitHub Action).
