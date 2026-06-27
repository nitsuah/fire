# METRICS.md

## Metrics Table

| Metric                            | Current                                  | Target  | Status       |
| :-------------------------------- | :--------------------------------------- | :------ | :----------- |
| Coverage — Statements             | 88%                                   | 80%     | Below Target |
| Coverage — Branch                 | 26.2%                                    | 80%     | Below Target |
| Coverage — Functions              | 26.56%                                   | 80%     | Below Target |
| Coverage — Lines                  | 25.79%                                   | 80%     | Below Target |
| Total Tests                       | 198                                      | 100+    | Met          |
| CI/CD Build Status                | Passing (GitHub Actions)                 | Passing | Met          |
| ESLint Violations                 | 0                                        | 0       | Met          |
| Dependency Vulnerabilities        | 6 moderate/critical (dev deps only)      | 0       | Below Target |
| Total Lines of Code (LOC)         | ~3,400 JS / ~5,900 all files             | N/A     | Tracked      |
| Cyclomatic Complexity             | TBD                                      | <10     | Untracked    |
| API Average Response Time         | TBD                                      | <100ms  | Untracked    |
| Client Bundle Size (app.js)       | ~117 KB                                  | <500 KB | Met          |
| Build Success Rate                | N/A (no build step)                      | 99%     | N/A          |
| Deployment Frequency              | TBD                                      | Weekly  | Untracked    |
| Last updated                      | 2026-06-25                               |         |              |

## How to Update

To gather and update these metrics, follow these steps:

1.  **Test Coverage (Lines):**
    ```bash
    npm test -- --coverage --coverageReporters=text-lcov | grep -E 'Lines|Statements' | awk '{print $4}'
    # Manually extract the percentage
    ```
