## deni-ai-desktop-updater

This server converts GitHub Releases from `deniaiapp/desktop` into a Tauri 2 updater `latest.json` response.

### Endpoints

- `GET /stable/latest.json`
  - Returns the latest stable release
- `GET /canary/latest.json`
  - Returns the latest release, including pre-releases
- `GET /healthz`
  - Health check

### Development

```sh
bun install
bun run dev
```
