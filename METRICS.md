# METRICS.md

This document outlines key metrics for the `nitsuah/fire` project, providing insights into its health, quality, and performance.

## Key Metrics

Here are the primary metrics we track:

1.  **Test Coverage (Lines/Statements):** The percentage of lines or statements in the codebase that are executed by tests.
2.  **Total Unit Tests:** The total number of individual unit tests defined in the project.
3.  **CI/CD Build Status:** The current status of the latest continuous integration/continuous deployment build (e.g., passing, failing).
4.  **ESLint Violations:** The number of issues reported by ESLint, indicating potential code style, quality, or error-prone patterns.
5.  **Dependency Vulnerabilities:** The count of known security vulnerabilities identified in the project's dependencies.
6.  **Total Lines of Code (LOC):** The overall size of the codebase, excluding comments and blank lines.
7.  **Cyclomatic Complexity:** A measure of the number of linearly independent paths through a program's source code, indicating potential complexity and testability.
8.  **API Average Response Time (ms):** The average time taken for the API server to respond to typical requests under load.
9.  **Server Bundle Size (KB):** The compressed size of the production-ready JavaScript bundle for the server, impacting deployment and startup time.
10. **Build Success Rate:** The percentage of successful builds in the CI/CD pipeline over a defined period.
11. **Deployment Frequency:** How often new versions of the application are deployed to a production-like environment.

## Metrics Table

| Metric                       | Current | Target | Status      |
| :--------------------------- | :------ | :----- | :---------- |
| Total Coverage               | 0%      | 80%    | Untracked   |
| Total Unit Tests             | TBD     | 100+   | Untracked   |
| CI/CD Build Status           | TBD     | Passing| Untracked   |
| ESLint Violations            | TBD     | 0      | Untracked   |
| Dependency Vulnerabilities   | TBD     | 0      | Untracked   |
| Total Lines of Code (LOC)    | TBD     | N/A    | Untracked   |
| Cyclomatic Complexity        | TBD     | <10    | Untracked   |
| API Average Response Time    | TBD     | <100ms | Untracked   |
| Server Bundle Size           | TBD     | <500KB | Untracked   |
| Build Success Rate           | TBD     | 99%    | Untracked   |
| Deployment Frequency         | TBD     | Weekly | Untracked   |

## How to Update

To gather and update these metrics, follow these steps:

1.  **Test Coverage (Lines):**
    ```bash
    npm test -- --coverage --coverageReporters=text-lcov | grep -E 'Lines|Statements' | awk '{print $4}'
    # Manually extract the percentage