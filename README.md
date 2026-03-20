## deni-ai-desktop-updater

`deniaiapp/desktop` の GitHub Releases を Tauri 2 updater 向けの `latest.json` に変換して返すサーバーです。

### Endpoints

- `GET /stable/latest.json`
  - 最新の stable release を返します
- `GET /canary/latest.json`
  - pre-release を含む最新 release を返します
- `GET /healthz`
  - ヘルスチェック

### Development

```sh
bun install
bun run dev
```

### Notes

- `GITHUB_TOKEN` を設定すると GitHub API rate limit を回避しやすくなります。
- このサーバーは release asset から Tauri updater artifact を探します。
- `deniaiapp/desktop` 側に updater 用の asset と対応する `.sig` が無い release は `404 updater_artifacts_missing` を返します。
- 2026-03-20 時点では `deniaiapp/desktop` に stable release はありません。
- 2026-03-20 時点の最新 canary release には macOS / Windows / Linux 向け updater artifact があります。
