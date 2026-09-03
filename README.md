# Addarr

One-tap movie & series adds for Radarr and Sonarr. Built for the home LAN: non-technical household members search for a title and tap **Add** — done. An admin configures exactly what "Add" means and gets deep, curated control over the *arr instances.

The browser only ever talks to Addarr. Radarr/Sonarr API keys live server-side (SQLite) and never reach the client.

## Features

- **Member mode** — search box → poster grid → one **Add** button. "In library ✓" badge, live `queued → downloading → available` status after adding.
- **Admin presets** — define what Add does per service: quality profile, root folder, monitored, tags, minimum availability, search-on-add, and (Sonarr) series type + season monitoring policy. The default preset powers the member Add button.
- **Operations console** — curated screens for day-to-day acquisition: library edit/delete (typed confirmation), queue, history, import exclusions, blocklist, calendar, and hand-picked commands (`MoviesSearch`, `SeriesSearch`, `EpisodesSearch`, `RefreshMonitoredDownloads`). No free-form commands.
- **Read-only passthrough** — `GET /arrapi/:service/<allow-listed path>` to inspect any payload the curated UI doesn't show. Write verbs are structurally blocked.
- **Activity log** — who added what, when, plus admin actions.

## Stack

Node.js + TypeScript, SvelteKit (SSR), SQLite (`node:sqlite`, zero native deps). One process, no build artifacts to ship, no containers — just `npm start`.

## Setup (Windows / macOS / Linux)

All you need is **Node.js 22.5 or newer** (an LTS release is fine) and **Git**. Everything else is automatic — `npm start` installs dependencies, builds, and serves.

### 1. Install Node.js and Git

**Windows** (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS Git.Git
```

Or download the installers from [nodejs.org](https://nodejs.org) and [git-scm.com](https://git-scm.com). Close and reopen your terminal afterwards so the PATH updates.

**macOS** (Terminal, with [Homebrew](https://brew.sh)):

```sh
brew install node git
```

Or grab the `.pkg` installers from nodejs.org and git-scm.com.

**Linux** (Debian/Ubuntu):

```sh
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

(Fedora: `sudo dnf install nodejs git` — or use [nvm](https://github.com/nvm-sh/nvm) on any distro to get the latest Node.)

Verify before continuing:

```sh
node -v   # must be 22.5 or higher
git --version
```

### 2. Get the code and start it

Same on every OS:

```sh
git clone https://github.com/edrickt/addarr.git
cd addarr
npm start
```

`npm start` installs, builds, and launches the server in one go. First run takes a minute; subsequent runs are faster.

On Windows, allow Node.js through the Windows Defender firewall prompt if it appears (check both **Private** and **Public** networks if you'll serve over LAN).

### 3. Open the app

Browse to `http://localhost:3000`. Other devices on your LAN use `http://<your-machine-ip>:3000` (find the IP with `ipconfig` on Windows, `ipconfig getifaddr en0` on macOS, or `ip addr` on Linux).

### Useful options

```sh
PORT=8080 npm start                # different port (Windows PowerShell: $env:PORT=8080; npm start)
ADDARR_DB=/path/to/addarr.db npm start   # custom data file location
npm run dev                        # development mode with hot reload
```

### Sharing on your LAN (broadcasting)

By default Addarr binds to `localhost` only — nothing else on the network can reach it. To open it up to your LAN **and** broadcast it over mDNS/Bonjour (so it shows up as "Addarr" in network discovery, e.g. Safari's Bonjour list or an Avahi browser), enable LAN mode:

```sh
npm start -- --lan                 # Windows PowerShell: $env:ADDARR_LAN=1; npm start
```

The startup log prints the LAN URL to hand out (e.g. `http://192.168.1.23:3000`). You can also set `HOST` explicitly (`HOST=192.168.1.23`) to bind a single interface. If mDNS is blocked on your network (some VPNs/containers), Addarr still runs — discovery just won't work.

Data (users, sessions, connections, presets, activity log) lives in one SQLite file, `data/addarr.db` by default. Back that file up and you've backed up the whole app.

## First run

1. Open `http://<host>:3000` → you're redirected to **Setup**: create the admin account (username + 4–6 digit PIN).
2. **Settings** → connect Radarr and Sonarr (URL + API key). A capability probe verifies the version before saving, and a usable default preset is created automatically from the instance's first quality profile / root folder.
3. **Members** → add household members (username + PIN).
4. Hand them the URL. That's it.

Members sign in with their name and PIN; admins get 12-hour sessions, members 30-day rolling sessions.

## LAN only

Addarr is designed for trusted networks. LAN access is opt-in (see **Sharing on your LAN** above) — use Tailscale/WireGuard for remote access; there is no HTTPS hardening built in, by design.

## API surface (internal)

| Route | Who | Does |
|---|---|---|
| `GET /api/search?service=movie\|series&q=` | member | trimmed poster-card lookup + in-library flag |
| `POST /api/add` | member | add via default preset, dedupe-checked, logged |
| `GET /api/status/:kind/:id` | member | polled badge: waiting/queued/downloading/available |
| `/api/presets` | admin | preset CRUD + live dropdown options |
| `/api/console/*` | admin | library, queue, history, exclusions, blocklist, calendar, curated commands |
| `/api/services`, `/api/users`, `/api/activity` | admin | connections, members, activity log |
| `GET /arrapi/:service/*` | admin | allow-listed read-only passthrough |

See `PLAN.md` for the full architecture and milestone history.
