# VerkiezingsWinnaar frontend

Static React and TypeScript dashboard. Election settings and the public feed URL are build-time configuration; no server or private credentials are included in the browser app.

## Local replay preview

1. In `Backend`, run `uv run python -m http.server 63343`.
2. In another terminal, run `uv run python main_replay_elections_test.py local`. It replays `testdata/GR2026-03-17.jsonl` one snapshot every four seconds into `Backend/replay-output/data-test.jsonl.gz`.
3. In `Frontend`, copy `.env.example` to `.env.local`, run `pnpm install --frozen-lockfile` once, then `pnpm dev`.

The Vite dev server proxies `/test-feed/` to the local Backend server on port 63343 so the browser reads the replay feed from the same origin. To select another night, pass `--fixture testdata/GR2026-03-16.jsonl` to the replay script.

## Tests and build

Run `pnpm test` and `pnpm build`. The Vitest suite reads the historical election-night fixtures in `Backend/testdata`, including a single-line feed case.

## R2 test replay

Configure `CLOUDFLARE_R2_TEST_UPLOAD_URL` to the upload Worker URL ending in `/data-test.jsonl.gz`, plus `CLOUDFLARE_R2_WRITE_TOKEN`. Then run `uv run python main_replay_elections_test.py r2`. Each snapshot uploads the cumulative gzip feed at four-second intervals. The Worker accepts only the regular feed and this dedicated test object; the replay helper refuses R2 URLs not ending in `/data-test.jsonl.gz`.

Set `VITE_DATA_URL` to the public read URL for `data-test.jsonl.gz` when building to exercise the R2 feed. Never point test configuration at the live key.

## GitHub Pages

The Pages workflow builds from the `main` branch and deploys through GitHub Actions. It defaults to the public Cloudflare R2 production feed; set the repository Actions variable `VITE_DATA_URL` only if the feed URL changes. The build uses `/` as its base path so it works on the custom domain.

GitHub Pages must use **GitHub Actions** as its publishing source. The built site includes `CNAME` for `verkiezingswinnaar.nl`; configure the domain's apex DNS records to point to GitHub Pages and enable HTTPS in the repository's Pages settings.

After deployment, verify that [https://verkiezingswinnaar.nl/](https://verkiezingswinnaar.nl/) loads over HTTPS and that the page can fetch the live results from Cloudflare R2.
