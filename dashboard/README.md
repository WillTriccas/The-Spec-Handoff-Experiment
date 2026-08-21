# Dashboard

A measured-ready React dashboard bundled as one HTML file. Before execution it
shows only the pre-registered matrix, protocol, and `not-evaluated` statuses.

```powershell
npm --workspace dashboard run test
npm --workspace dashboard run build:singlefile
```

Generated output is written to `dashboard/dist-single/index.html` and is not
tracked.
