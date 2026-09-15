# Addarr

One-tap movie & series adds for Radarr and Sonarr. Built for the home LAN: non-technical household members search for a title and tap **Add**. Done. An admin configures exactly what "Add" means and gets deep, curated control over the *arr instances.

The browser only ever talks to Addarr. Radarr/Sonarr API keys live server-side (SQLite) and never reach the client.

## Features

- **Member mode:** search box → poster grid → one **Add** button, no account needed. "In library ✓" badge, live acquisition status after adding: `queued → downloading → importing → available`, plus paused/partial states, with a progress bar and time-left on the poster.
- **Admin presets** define what Add does per service: quality profile, root folder, monitored, tags, minimum availability, search-on-add, and (Sonarr) series type + season monitoring policy. The default preset powers the member Add button.
- **Operations console:** curated screens for day-to-day acquisition: library edit/delete (typed confirmation), queue, history, import exclusions, blocklist, calendar, and hand-picked commands (`MoviesSearch`, `SeriesSearch`, `EpisodesSearch`, `RefreshMonitoredDownloads`). No free-form commands.
- **Read-only passthrough:** `GET /arrapi/:service/<allow-listed path>` to inspect any payload the curated UI doesn't show. Write verbs are structurally blocked.
- **Activity log:** who added what, when, plus admin actions.

## Stack

Node.js + TypeScript, SvelteKit (SSR), SQLite (`node:sqlite`, zero native deps). One process, no build artifacts to ship, no containers — just `npm start`.

## Setup (Windows / macOS / Linux)

### Requirements

- **Node.js 22.5 or newer** (an LTS release is fine), the only hard requirement. Check with `node -v`.
- **Git**, *optional*; only needed if you want to clone or update via git. Downloading a ZIP works just as well.

No database server, no build tools, no containers; `npm start` handles everything else, installing dependencies, building, and starting the server in the background.

### 1. Install Node.js

**Windows** (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download the installer from [nodejs.org](https://nodejs.org). Close and reopen your terminal afterwards so the PATH updates.

**macOS** (Terminal, with [Homebrew](https://brew.sh)):

```sh
brew install node
```

Or grab the `.pkg` installer from nodejs.org.

**Linux** (Debian/Ubuntu):

```sh
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

(Fedora: `sudo dnf install nodejs`; or use [nvm](https://github.com/nvm-sh/nvm) on any distro to get the latest Node.)

### 2. Get the code

Any way you like, e.g.:

- **Download a ZIP**: on the GitHub repo page, **Code → Download ZIP**, then extract it and `cd` into the extracted folder in your terminal.
- **Clone** (requires Git):

  ```sh
  git clone https://github.com/edrickt/addarr.git
  cd addarr
  ```

### 3. Start it

In the folder containing `package.json`:

```sh
npm start
```

First run takes a minute; subsequent runs are faster. Updating later is the same: grab the latest code (re-download the ZIP or `git pull`) and run `npm start` again.

`npm start` installs Addarr as a **background service** and starts it. The server keeps running after you close the terminal and comes back when you log in. It also drops a desktop icon:

| Platform | Icon | Where it lives |
|---|---|---|
| macOS | **Addarr** app | `~/Applications` — Launchpad, Spotlight, Dock |
| Linux | **Addarr** app | applications menu (`~/.local/share/applications`) |
| Windows | **Addarr** shortcut | Start menu, plus a hidden launcher in Startup |

Click the **Addarr** icon to start the server if it isn't running and open it in your browser. That is the everyday way in; the terminal is only needed for installing and updating.

On Windows, allow Node.js through the Windows Defender firewall prompt if it appears (check both **Private** and **Public** networks if you'll serve over LAN).

### 4. Open the app

`npm start` opens it for you. After that, use the **Addarr** icon or browse to `http://localhost:4545`. Other devices on your LAN use `http://<your-machine-ip>:4545` (find the IP with `ipconfig` on Windows, `ipconfig getifaddr en0` on macOS, or `ip addr` on Linux).

### Useful options

```sh
npm run status                     # is it running?
npm run logs                       # follow the log (data/addarr.log)
npm run restart                    # restart the server
npm run stop                       # stop it until the next start, click, or login
npm run uninstall                  # remove the service and the icon (data/addarr.db is kept)
npm run start:foreground           # run in this terminal instead, with logs on screen
npm run dev                        # development mode with hot reload

PORT=8080 npm start                # different port (Windows PowerShell: $env:PORT=8080; npm start)
ADDARR_DB=/path/to/addarr.db npm start   # custom data file location
```

`npm start` bakes `PORT`, `HOST`, `ADDARR_LAN`, and `ADDARR_DB` into the background service, so re-run it to change any of those. `npm run start:foreground` is the "watch it work" mode; it needs the terminal to stay open.

### Sharing on your LAN (broadcasting)

By default Addarr binds to `localhost` only, so nothing else on the network can reach it. To share it, sign in as admin and go to **Settings → Network → Share on LAN**. When enabled, Addarr:

- becomes reachable from other devices at `http://<your-machine-ip>:4545` (the address is printed in the startup log), and
- broadcasts itself over mDNS/Bonjour as **"Addarr"**, so it shows up in network discovery (e.g. Safari's Bonjour list or an Avahi browser).

Enabling the setting takes effect for discovery immediately; if the server was started in localhost-only mode, one restart is needed to open the network bind — the app tells you when that's the case.

For headless setups you can also force it at startup: `npm start -- --lan` (or `ADDARR_LAN=1`), which overrides the in-app setting. `HOST=<addr>` binds a specific interface. Both are baked into the background service, so re-run `npm start` without them to hand control back to the in-app toggle. If mDNS is blocked on your network (some VPNs/containers), Addarr still runs; discovery just won't work.

**Tailscale note:** with "Share on LAN" on, Addarr listens on `0.0.0.0`, so it's also reachable over your Tailnet — and the startup log used to lead with the `100.x` Tailscale address. It now lists the physical LAN address first (Tailscale last). To keep Addarr off the Tailnet entirely, bind just your LAN interface: `HOST=192.168.1.x npm start` (use your machine's LAN IP).

Data (users, sessions, connections, presets, activity log) lives in one SQLite file, `data/addarr.db` by default. Back that file up and you've backed up the whole app.

## First run

1. Open `http://<host>:4545` → you're redirected to **Setup**: create the admin account (username + 4–6 digit PIN).
2. **Settings** → connect Radarr and Sonarr (URL + API key). A capability probe verifies the version before saving, and a usable default preset is created automatically from the instance's first quality profile / root folder.
3. Hand the household the URL; that's it. **Members need no account**: they search and add anonymously. Only signing into Settings/Console asks for the admin PIN (12-hour sessions, with a failed-attempt backoff against PIN guessing).

## LAN only

Addarr is designed for trusted networks. LAN access is opt-in (see **Sharing on your LAN** above). For remote access, use Tailscale or WireGuard; there is no HTTPS hardening built in, by design.

## API surface (internal)

| Route | Who | Does |
|---|---|---|
| `GET /api/search?service=movie\|series&q=` | member | trimmed poster-card lookup + in-library flag |
| `POST /api/add` | member | add via default preset, dedupe-checked, logged |
| `GET /api/status/:kind/:id` | member | polled badge: queued/downloading/importing/partial/paused/attention/missing/unreleased/available |
| `/api/presets` | admin | preset CRUD + live dropdown options |
| `/api/console/*` | admin | library, queue, history, exclusions, blocklist, calendar, curated commands |
| `/api/services`, `/api/activity` | admin | connections, activity log |
| `GET /arrapi/:service/*` | admin | allow-listed read-only passthrough |

See `PLAN.md` for the full architecture and milestone history.
