# Nest Config Links

**Follow a NestJS configuration value from its declaration to every place that uses it — without leaving VS Code.**

Nest Config Links turns `registerAs()` configuration into a navigable workspace graph. It is useful in larger NestJS projects where a namespace such as `mail`, `redis`, or `authService` is declared in one file but consumed across HTTP apps, workers, providers, and modules.

The extension recognizes `registerAs()` namespaces and links them to `ConfigService.get()` / `getOrThrow()` calls, `ConfigType<typeof config>` typed injections, `@Inject(config.KEY)`, and `ConfigModule.forRoot({ load: [...] })` registrations.

```ts
export const mailConfig = registerAs('mail', () => ({
  host: process.env.SMTP_HOST?.trim() || undefined,
  port: Number.parseInt(process.env.SMTP_PORT ?? '587', 10),
}));
```

From this declaration, the extension can show the `mail.host` and `mail.port` keys, their source expressions and inferred types, where the namespace is registered, and each use such as `config.get('mail.host')`.

## What it shows

- Configuration namespaces and their keys.
- Inferred lightweight TypeScript types and the source expression/default value.
- Workspace usages grouped by key.
- Nest module registration locations.
- Tree View, CodeLens, hover information, and completion for `ConfigService.get('namespace.`.
- One-click navigation from a key or usage to its exact source location.

## Privacy and safety

Secrets are not read or revealed. The extension displays source expressions, such as `process.env.SMTP_HOST?.trim() || undefined`, not the resolved value. It does not upload workspace code or environment files anywhere.

## Supported patterns

- `registerAs('namespace', () => ({ ... }))`
- `ConfigService.get('namespace.key')`
- `ConfigService.getOrThrow('namespace.key')`
- `ConfigType<typeof namespaceConfig>`
- `@Inject(namespaceConfig.KEY)`
- `ConfigModule.forRoot({ load: [namespaceConfig] })`

## Usage

1. Open a NestJS workspace.
2. Open the **Nest Config** activity-bar view.
3. Run **Nest Config Links: Refresh**, or save a TypeScript source file.
4. Click a configuration key or usage to jump to its source.

Place the cursor on a `registerAs()` declaration and run **Nest Config Links: Show Usages** to focus the explorer.

## Development

```bash
pnpm install
pnpm compile
```

Then press `F5` in VS Code to launch an Extension Development Host.

## Publishing

```bash
pnpm package
npx @vscode/vsce publish
```

Publishing requires a Visual Studio Marketplace publisher and a token with `Marketplace → Manage` access.
