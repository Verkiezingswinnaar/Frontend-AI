# VerkiezingsWinnaar frontend

Static React and TypeScript dashboard. At runtime, the app reads the active election IDs from `active-elections.json`, loads the corresponding `results-{ID}.json` metadata, and polls `data-{current-ID}.jsonl.gz`. `VITE_ELECTION_DATA_BASE_URL` sets the base URL containing those files. No server or private credentials are included in the browser app.

The `type` in the current results metadata determines the chart: `national` charts seats, while `municipal`, `provincial`, and `other` chart vote shares. National feeds can provide `seats_prediction` and `seats_last_election` per party; missing seat counts are left blank rather than inferred.

## Local replay preview

1. In `Backend`, run `uv run python -m http.server 63343`.
2. In another terminal, run `uv run python main_replay_elections_test.py local`. It replays `testdata/GR2026-03-17.jsonl` one snapshot every four seconds into `Backend/data-TK2025.jsonl.gz` by default.
3. In `Frontend`, copy `.env.example` to `.env.local`, run `pnpm install --frozen-lockfile` once, then `pnpm dev`.

The Vite dev server proxies `/election-assets/` to the local Backend server on port 63343. The default `active-elections.json` selects `TK2025`, so the default local replay output matches the feed URL requested by the app. To select another night, pass `--fixture testdata/GR2026-03-16.jsonl` to the replay script.

## Tests and build

Run `pnpm test` and `pnpm build`. The Vitest suite reads the historical election-night fixtures in `Backend/testdata`, including a single-line feed case.

## R2 test replay

The frontend does not request `data-test.jsonl.gz`; it derives the feed filename from `active-elections.json`. To preview from a separate R2 test bucket, configure `VITE_ELECTION_DATA_BASE_URL` to that bucket and provide a matching `active-elections.json`, both `results-{ID}.json` files, and the current `data-{ID}.jsonl.gz` feed there.

## GitHub Pages

The Pages workflow builds from the `main` branch and deploys through GitHub Actions. It defaults to the public Cloudflare R2 production bucket; set the repository Actions variable `VITE_ELECTION_DATA_BASE_URL` if the bucket URL changes. The build uses `/` as its base path so it works on the custom domain.

GitHub Pages must use **GitHub Actions** as its publishing source. The built site includes `CNAME` for `verkiezingswinnaar.nl`; configure the domain's apex DNS records to point to GitHub Pages and enable HTTPS in the repository's Pages settings.

After deployment, verify that [https://verkiezingswinnaar.nl/](https://verkiezingswinnaar.nl/) loads over HTTPS and that the page can fetch the live results from Cloudflare R2.
