# GitHub Copilot Instructions

This file provides custom instructions to GitHub Copilot when working in this repository.

## Project Context

**Project Name:** fire  
**Description:** Lightweight fire tracker & API server for tracking financial independence, retire early goals.  
**Tech Stack:** JavaScript (Node.js 22), Express 5 API server, a vanilla-JS single-page app (`app/`), JSON-file persistence (`data/db.json`, optionally AES-256-GCM encrypted), Netlify Functions for the hosted deploy, Vitest + Playwright for tests.

## Code Style & Conventions

### General Guidelines

- Follow existing code patterns and file structure.
- Maintain consistent naming conventions across the codebase (e.g., `camelCase` for variables/functions, `PascalCase` for classes/constructors).
- Write self-documenting code with clear variable and function names.
- Add comments only when the code's intent is not immediately clear or for complex business logic.

### Language-Specific Guidelines

- **JavaScript**:
    - Use modern ES6+ features (`const`, `let`, arrow functions, destructuring).
    - Prefer asynchronous patterns using `async/await` over callbacks or `.then().catch()`.
    - Follow a consistent linting style (e.g., StandardJS or Airbnb style, if not explicitly configured, lean towards readability and consistency with existing files).
    - Avoid global variables.
    - Handle errors gracefully using `try...catch` blocks for asynchronous operations.
- **Database**:
    - Use parameterized queries to prevent SQL injection.
    - Never use string concatenation for building SQL queries.
    - Prefer using an ORM or query builder (e.g., Knex.js, Sequelize) for complex database interactions.

### File Organization

- Keep files focused on a single responsibility.
- Group related functionality in feature-specific directories (e.g., `src/transactions`, `src/users`).
- Place utility functions in a `src/utils` directory.
- Database access logic should be separated from API route handlers (e.g., `src/models` or `src/db`).
- Middleware should be placed in `src/middleware`.

## Architecture Patterns

### Module Structure

- Organize modules by feature or domain (e.g., `src/transactions/transactionService.js`, `src/transactions/transactionController.js`).
- Keep modules small and focused on a single responsibility (e.g., a controller for handling requests, a service for business logic, a model for data access).
- Extract reusable utilities or middleware into dedicated files.

### Data Flow

- All incoming requests should pass through appropriate validation middleware.
- Business logic should reside in service layers, separate from controllers.
- Database interactions should be handled by dedicated data access modules (models).
- Implement proper error handling middleware to catch and format errors consistently.
- Handle loading states consistently (though less relevant for a pure API, consider client-side implications).

### API Design

- Design RESTful endpoints with consistent naming conventions (e.g., `/api/v1/transactions`, `/api/v1/users`).
- Validate all inputs at the API boundary using a validation library (e.g., Joi, express-validator).
- Return appropriate HTTP status codes (2xx for success, 4xx for client errors, 5xx for server errors).
- Include proper error messages and context in API responses for client-side debugging.

## Testing Strategy

- Write unit tests for utility functions, service layers, and data access modules.
- Write integration tests for API endpoints

## Closing tracked work

week-sotu and vigil read `docs/TASKS.md` from `main`, so an item left unmarked keeps showing as open work. A PR that finishes a tracked item closes it in the same PR, in this order:

1. Finish the code and tests.
2. Before the **last** push, update the docs in the same branch: mark the `docs/TASKS.md` item `- [x]` with a one-line `Done <date>: <what>` note (or record partial progress; to cite the PR number, open the PR as a draft first and add it in this commit). If the `docs/TASKS.md` footer says finished items are removed rather than ticked, remove it and condense it into `docs/CHANGELOG.md` / `docs/FEATURES.md` instead. Tick or condense the matching `docs/ROADMAP.md` line, add a `docs/CHANGELOG.md` Unreleased line, and fix `README.md` / `docs/FEATURES.md` if the change alters what they claim.
3. Commit and push, then open the PR. Say in its description which items it closes (the PR template has a slot for it).
4. **Pre-merge check**, next to CI and review threads: `git diff origin/main...HEAD --stat` must include the tracking docs whenever the PR completes a tracked item. If it doesn't, add the docs commit before merging. Never merge first and "follow up with a docs PR"; that's how stash#158/#159 and avatar#35 left finished work open (2026-09-30).

**A docs-only status PR changes status, nothing else.** When you do have to close items after the fact, touch only the lines for the items you cite (tick, `Done` note, PR link). Don't add, reword, reorder or delete other items, and don't regenerate the file from a template.
