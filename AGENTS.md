# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the Squoosh web application, including UI pages, features, image processors, workers, service-worker code, and shared utilities.
- `codecs/` contains codec integrations and WebAssembly sources, such as `codecs/webp`, `codecs/jxl`, and `codecs/wp2`. Each codec may include its own `Makefile`, package metadata, generated bindings, and native sources.
- `lib/` contains Rollup build helpers and scripts. Root configuration includes `rollup.config.js` and the TypeScript `*-tsconfig.json` files.
- Static assets live alongside the relevant feature or page under `src/`, especially `src/static-build/assets/`.

## Build, Test, and Development Commands

Run `npm install` to install dependencies, then:

- `npm run build` - create a production build in the temporary build output.
- `npm run dev` - watch source changes and serve the app locally, normally on port 5000.
- `npm run watch` - run Rollup in watch mode without starting the server.
- `npm run debug` - launch Rollup with the Node inspector enabled.
- `make` from a codec directory - rebuild that codec's native/WebAssembly artifacts when codec sources change.

Run `npm test` for logic regression tests and `npm run test:browser` after a production build for browser regression tests in installed Microsoft Edge. Tests live in `tests/`. On Windows, `node tests/windows-launcher.cjs` validates the packaged EXE and reuses the browser suite; port 5000 must be free. Also validate changes with a production build and test affected codec paths when changing codec code.

## Coding Style & Naming Conventions

Use two spaces, LF line endings, UTF-8, and no trailing whitespace. Prettier is configured with single quotes and trailing commas; run `npx prettier --write <files>` for JavaScript, TypeScript, CSS, JSON, and Markdown. Use `clang-format` for C/C++ and `rustfmt` for Rust. Follow existing naming: kebab-case directories, descriptive lower-case filenames, and idiomatic TypeScript/Preact names.

## Commit & Pull Request Guidelines

Use concise, imperative commit subjects, such as `Replace deprecated terser plugin` or `Remove unused imports`. Keep commits focused. Pull requests require review and should explain the change, note validation performed, link any relevant issue, and include screenshots or recordings for UI changes. Contributions must have the Google Contributor License Agreement completed; see `CONTRIBUTING.md`.

## Security & Configuration Tips

Image processing is intended to remain client-side. Do not add server-side image uploads or commit secrets. Keep generated WebAssembly outputs consistent with their codec source changes.
