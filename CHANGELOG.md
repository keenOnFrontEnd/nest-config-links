# Changelog

All notable changes to this project are documented here.

## 0.2.2 — 2026-08-31

- Recognize the standard `registerAs('name', () => ({ ... }))` syntax, whose return object is parenthesized in the TypeScript AST.

## 0.2.1 — 2026-08-31

- Scan each supported TypeScript extension explicitly and index unsaved open editors, preventing incomplete configuration results.

## 0.2.0 — 2026-08-31

- Add the **Nest Modules** explorer for `@Module()` declarations and their imports, providers, controllers, exports, and incoming imports.

## 0.1.3 — 2026-08-31

- Detect each explicit item in `ConfigModule.forRoot({ load: [...] })` instead of relying on text matching.
- Report direct config-factory calls such as `grpcClientTlsConfig()` as usages.

## 0.1.1 — 2026-08-31

- Bundle the TypeScript AST dependency into the VSIX so the extension activates correctly after installation.

## 0.1.2 — 2026-08-31

- Improve inferred types for environment-variable expressions and local fallback bindings inside config factories.

## 0.1.0 — 2026-08-31

- Initial release.
- Explore `registerAs()` namespaces, keys, inferred types, expressions, registrations, and usages.
- Add Tree View, CodeLens, hover details, key completions, and source navigation.
