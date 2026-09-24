# METRICS.md

## Metrics Table

| Metric                            | Current                                  | Target  | Status       |
| :-------------------------------- | :--------------------------------------- | :------ | :----------- |
| Code Coverage | 83.76% stmts / **68.68% branch** / 82.81% funcs / 83.87% lines (Docker, 2026-09-24) | 80% stmts/funcs/lines, 70% branch (`config/vitest.config.ts`) | **Below Target (branch)**: `npm run test:coverage` exits 1 with `Coverage for branches (68.68%) does not meet global threshold (70%)`. See TASKS.md |
| Total Tests | 472 (42 files, all passing, Docker 2026-09-24) | 100+ | Met |
| CI/CD Build Status                | Passing (GitHub Actions)                 | Passing | Met          |
| ESLint Violations                 | 0                                        | 0       | Met          |
| Dependency Vulnerabilities        | 1 high (dev deps only, via `npm audit`)  | 0       | Below Target |
| Total Lines of Code (LOC)         | TBD (run `cloc app/`)                    | N/A     | Tracked      |
| Cyclomatic Complexity             | TBD                                      | <10     | Untracked    |
| API Average Response Time         | TBD                                      | <100ms  | Untracked    |
| Client JS Size (app/lib/)         | TBD (no build step, modules served raw)  | N/A     | N/A          |
| Build Success Rate                | N/A (no build step)                      | 99%     | N/A          |
| Deployment Frequency              | TBD                                      | Weekly  | Untracked    |
| Last updated | 2026-09-24 (PMO audit: `docker build --target test -t fire-test .` + `docker run --rm -u root fire-test npm run test:coverage`. `-u root` is needed because the image can't write `/app/coverage`, see TASKS.md) |  |  |

## How to Update

To gather and update these metrics, follow these steps:

1.  **Test Coverage (Lines):**
    ```bash
    npm test -- --coverage --coverageReporters=text-lcov | grep -E 'Lines|Statements' | awk '{print $4}'
    # Manually extract the percentage
    ```
