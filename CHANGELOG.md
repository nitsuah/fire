# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- API endpoints for managing user profiles and authentication.
- CRUD operations for income, expense, and investment transactions.
- Data models for financial records (income, expenses, investments, assets, liabilities).
- Initial calculations for net worth and basic FIRE progress indicators.
- Basic data persistence layer (e.g., file-based storage or a simple database integration placeholder).
- Middleware for request validation and error handling.
- Express error-handling middleware (`app.use((err, req, res, next) => ...)`) added to `server.js` to catch unhandled route errors and return 500 JSON instead of crashing.
- `findAvailablePort` now rejects immediately when called with an empty candidates array and handles errors from the OS-assigned fallback listener.
- `OAUTH_CALLBACK_URL` environment variable for configuring the OAuth redirect URI instead of deriving it from the port.
- JSONata mapping expressions are now validated at template creation time (`POST /api/sync/templates`).
- Webhook type is now validated against supported values at template creation time.
- JSONata evaluation in the webhook handler now times out after 5 seconds.
- `AbortSignal.timeout(10000)` added to all outbound Yahoo Finance fetch calls.
- `defaultState()` extracted from `initDatabase` and reused in `readState` fallback so a corrupt database returns a fully-initialized state instead of `{}`.

### Changed

- `readState` now returns the full default state schema on parse failure instead of an empty object.
- `GET /api/sync/init` now sets `req.session.oauthState` instead of replacing the entire session object.
- `GET /api/sync/data` now wraps token file read and decryption in a try/catch and returns 500 on failure.
- `routes/prices.js` now validates `req.query.symbols` is a string before calling `.split()`.
- `routes/state.js` POST now rejects non-object request bodies with HTTP 400.
- `routes/accounts.js` PUT now validates `value` and `apy` with `Number.isFinite` and returns 400 on invalid input.
- `routes/cds.js` PUT now validates `principal` and `rate` with `Number.isFinite` and returns 400 on invalid input.
- `managers/accounts.js` `saveEditAccount` now validates `value` is finite before mutating state.
- `managers/vehicles.js` `saveEditVehicle` now preserves existing `trim`, `color`, `monthlyPayment`, and `notes` when the edit form does not render those inputs.
- `managers/vehicles.js` vehicle IDs are now generated with `Date.now() + random suffix` to avoid millisecond collisions.
- `managers/cds.js` CD start date default now uses local date instead of UTC `toISOString()`.
- `managers/real-estate.js` `saveEditRealEstate` now preserves existing `notes` when the input is not in the DOM.
- `tables/dashboard.js` `renderQuickStatsList` now uses null-safe element lookups for all stat elements.
- `tables/liquid.js` CD entries missing `maturity` or `rate` are now skipped.
- `tables/positions.js` duplicate `accPnLStyle`/`accValStyle` variables collapsed to `accStyle`; `pnlStyle`/`valStyle` collapsed to `posStyle`.
- `tables/projections-table.js` `coastYears` clamped to 0 to prevent negative label display.
- `tables/real-estate.js` view rows now HTML-escape `re.name`, `re.type`, and `re.address`.
- `charts/cd-ladder.js` empty-state now hides the canvas element and inserts a placeholder paragraph instead of destroying the canvas via `innerHTML`.
- `charts/cd-ladder.js` tooltip rate display now normalizes undefined `cd.rate` to 0.
- `charts/cd-ladder.js` `var cdLadderChart` replaced with `let`.
- `charts/allocation.js` unused `ALLOC_CATEGORY_KEYS` constant removed.
- `webhook-integration.js` CDs new-record spread order fixed so the generated `id` is not overridden by an incoming `id`.
- `webhook-integration.js` warn/error log statements no longer include the full data payload.
- `yahoo-prices.js` cookie extraction now uses `headers.getSetCookie()` when available (Node 18+).

### Fixed

- `DELETE /api/accounts/:id` returned HTTP 444 for a missing account; corrected to 404.

### Security

- `tables/real-estate.js` property names and addresses are now HTML-escaped before insertion into the DOM to prevent XSS.

## [0.1.0] - YYYY-MM-DD

### Added

- Project initialization

[Unreleased]: https://github.com/nitsuah/fire/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nitsuah/fire/releases/tag/v0.1.0