# ha-fusion

A modern, easy-to-use and performant custom [Home Assistant](https://www.home-assistant.io/) dashboard.

This is a personal fork of [ha-fusion](https://github.com/amedello/ha-fusion) by [amedello](https://github.com/amedello), itself a fork of the original [ha-fusion](https://github.com/matt8707/ha-fusion) by [matt8707](https://github.com/matt8707). I built this for my own home; sharing it in case it's useful to you. Issues are welcome and PRs will be reviewed when I have time, but accepted at my discretion.

[![preview](/static/preview.png)](https://youtu.be/2jNCyvkyLD8)

---

## What's new in this fork

Three features added on top of amedello's fork:

### 🎨 Per-view custom backgrounds

Set a background image for the whole dashboard or per-view, with smooth cross-fade transitions when switching views. Useful for visually distinguishing rooms or contexts (Watch / Music / Outside / etc.). Set per-view via the View edit modal; set dashboard-wide by adding `background: <url>` at the top of `dashboard.yaml` via the in-app code editor (`</>` toolbar button).

![custom background example](/static/feature-custom-background.png)

```yaml
# Dashboard-wide background (set via code editor)
background: 'https://example.com/site-wide.jpg'

views:
  - name: Watch
    background: 'https://example.com/ocean.jpg' # per-view override

  - name: Music
    background: 'https://example.com/stars.jpg'
```

Resolution order (later wins): theme background → dashboard background → view background.

### 💤 Screensaver

Optional idle overlay that fades in after a configurable timeout. Three modes: `clock` (live HH:MM clock), `black` (just dim the screen), or `template` (Jinja2-rendered HTML, useful for custom date/time displays). Tap or move pointer to dismiss. Configured via a `screensaver:` block at the top of `dashboard.yaml`:

```yaml
screensaver:
  enabled: true
  timeout: 600 # seconds of inactivity before fade-in
  mode: template
  template: "{{ now().strftime('%A, %B %-d') }}<br/>{{ now().strftime('%-I:%M %p') }}"
```

Pairs well with wall-mounted tablets running the dashboard 24/7.

### 🎵 Now Playing tile: hide name and artist

Two new opt-in fields on the `conditional_media` tile to remove the friendly_name row and/or the media_artist prefix from the Now Playing display. Useful when the tile is bound to a specific media player and you don't need the player's name repeated, or when you want a cleaner display showing just the title.

```yaml
- type: conditional_media
  entity_id: media_player.family_room_shield_cast
  media_players:
    - media_player.family_room_shield_cast
    - media_player.family_room_shield
  hide_name: true # drop the friendly_name row
  hide_artist: true # drop the media_artist prefix
```

---

## Inherited from amedello's fork

These features come from [amedello](https://github.com/amedello/ha-fusion) and are preserved in this fork:

### Built-in documentation

A **Documentation** button in the toolbar opens a full bilingual (IT/EN) manual covering installation, all item types, sidebar widgets, visibility conditions, Jinja2 templates, themes, custom CSS/JS and more. No external link required — the manual is bundled with the app.

### Custom Panel item type

A dashboard item type — `CUSTOM PANEL` — for multi-row tiles. Rows can be freely combined and reordered:

| Row type    | What it does                                                         |
| ----------- | -------------------------------------------------------------------- |
| **Camera**  | Embeds a camera stream (with optional live feed)                     |
| **Buttons** | Up to 4 action buttons per row, each fully configurable              |
| **Sensor**  | Displays a sensor or binary sensor value with optional prefix/suffix |
| **Slider**  | Controls a `light` or `number` entity via a brightness/value slider  |

A "primary entity" can be pinned to the tile so its state is always visible at a glance without opening the panel.

### Other improvements

- **Lock with code** — locks that expose `code_format: number` show a numeric keypad; `code_format: text` shows a text input.
- **`input_datetime` display** — the tile shows a locale-formatted date/time (e.g. "15 May 2023, 14:30") instead of the raw HA state string.
- **Edit toolbar** — add buttons are shown inline instead of inside a dropdown.

---

## Installation

### Docker (recommended)

Pre-built multi-architecture images are published to GitHub Container Registry: [`ghcr.io/hrc1079/ha-fusion`](https://github.com/hrc1079/ha-fusion/pkgs/container/ha-fusion).

```bash
docker run -d \
  --name ha-fusion \
  --network bridge \
  -p 5050:5050 \
  -v /path/to/ha-fusion:/app/data \
  -e TZ=America/Los_Angeles \
  -e HASS_URL=http://your-ha-instance:8123 \
  --restart unless-stopped \
  ghcr.io/hrc1079/ha-fusion:latest
```

Images are built automatically by GitHub Actions on every push to `main`. Tags available:

- `:latest` — most recent main-branch build (multi-arch: amd64, arm64, arm/v7)
- `:sha-<commit>` — pinned to a specific commit
- `:feature-<branch>` — feature-branch builds (when manually triggered)

#### docker-compose

```yaml
services:
  ha-fusion:
    image: ghcr.io/hrc1079/ha-fusion:latest
    container_name: ha-fusion
    network_mode: bridge
    ports:
      - 5050:5050
    volumes:
      - /path/to/ha-fusion:/app/data
    environment:
      - TZ=America/Los_Angeles
      - HASS_URL=http://your-ha-instance:8123
    restart: unless-stopped
```

### Auto-updates with Watchtower

To automatically pull and redeploy when new images are pushed, run [Watchtower](https://github.com/containrrr/watchtower) alongside ha-fusion and add an opt-in label to the ha-fusion container:

```yaml
services:
  ha-fusion:
    image: ghcr.io/hrc1079/ha-fusion:latest
    # ... rest of config above
    labels:
      - com.centurylinklabs.watchtower.enable=true

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_POLL_INTERVAL=3600 # check hourly
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_INCLUDE_RESTARTING=true
      - WATCHTOWER_LABEL_ENABLE=true # only update opt-in containers
    labels:
      - com.centurylinklabs.watchtower.enable=false # don't update Watchtower itself
```

### As a Home Assistant add-on

amedello's fork supports installation as an HA add-on. That path uses amedello's image, not this fork — to run this fork's features, use the Docker image above.

---

## Query strings

| Param          | Effect                                                 |
| -------------- | ------------------------------------------------------ |
| `?view=<name>` | Set a particular view on load                          |
| `?menu=false`  | Disable the menu button (e.g. on wall-mounted tablets) |

---

## Keyboard shortcuts

| Key                 | Description |
| ------------------- | ----------- |
| **f**               | filter      |
| **esc**             | exit        |
| **cmd + s**         | save        |
| **cmd + z**         | undo        |
| **cmd + shift + z** | redo        |

---

## Casting to Google/Nest displays

To cast a ha-fusion dashboard to a Nest Hub or Google Home display, use the [DashCast](https://github.com/AlexxIT/DashCast) Home Assistant integration. Use `dash_cast.load_url`, **not** `media_player.play_media` — the latter crashes Nest Hub displays.

```yaml
service: dash_cast.load_url
data:
  entity_id: media_player.family_room_display # your Nest Hub's media_player entity
  url: http://192.168.x.x:5050 # your ha-fusion URL (LAN-accessible)
  force: true
```

---

## Debug

- Backend: `docker logs ha-fusion`
- Frontend: open your browser's developer console

---

## Develop

```bash
# prerequisites
brew install node pnpm  # macOS, or your preferred package manager

# install
git clone https://github.com/hrc1079/ha-fusion.git
cd ha-fusion
pnpm install

# environment
cp .env.example .env
$EDITOR .env

# dev server
npm run dev -- --open

# lint and check
npm run check
npm run lint
npm run format
```

To contribute changes, fork the repo, push a branch, and open a PR. The CI workflow at `.github/workflows/docker-publish.yml` will build a multi-arch container image for feature branches when manually triggered (Actions → Publish Docker image → Run workflow).

---

## Credits

This project sits on top of two upstreams:

- **[matt8707/ha-fusion](https://github.com/matt8707/ha-fusion)** — original dashboard design, architecture, and the bulk of the codebase. All credit for the foundational work goes here.
- **[amedello/ha-fusion](https://github.com/amedello/ha-fusion)** — built-in documentation, Custom Panel item type, and various UX improvements.

Original demo video: <https://www.youtube.com/watch?v=D8mWruSuPOM>

This fork is released under the same license as the upstream (MIT).
