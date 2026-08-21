# Test-run evidence organization

Each versioned directory is immutable after measured publication and contains:

- `manifest.json` for the complete planned/imported matrix;
- `SUMMARY.md` for a plain-English status;
- `episodes/` and `repetitions/` views;
- `reports/` for machine-readable and rendered reports;
- `runs/<run-id>/` as the canonical link target for each cell.

Incomplete, duplicate, mixed-version, selectively rerun, or specification-hash
mismatched measured reports must fail closed.
