# Dashboard

A standalone dashboard for the 24 bounded-measured SpecForge FSI benchmark runs.
It reads `evidence/measured/report.json`; illustrative fixtures remain separate.

## Development

```bash
npm install
npm run dev
```

## Build

To build the standard distributable dashboard:

```bash
npm run build
```

To build a single self-contained HTML file (with all CSS/JS assets inlined):

```bash
npm run build:singlefile
```

## Testing

```bash
npm run test
```

## Theme

The dashboard uses the Clawpilot theme system. It checks the `clawpilotTheme`
query-string parameter or falls back to `prefers-color-scheme`. All colors use
the `--cp-*` theme variables.
