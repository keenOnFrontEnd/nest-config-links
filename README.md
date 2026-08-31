# Nest Config Links

Explore NestJS configuration as a navigable graph inside VS Code.

It recognizes `registerAs()` namespaces and links them to `ConfigService.get()` / `getOrThrow()` calls, `ConfigType<typeof config>` typed injections, and `ConfigModule.forRoot({ load: [...] })` registrations.

## What it shows

- Configuration namespaces and their keys.
- Inferred lightweight TypeScript types and the source expression/default value.
- Workspace usages grouped by key.
- Tree View, CodeLens, hover information, and completion for `ConfigService.get('namespace.`.

Secrets are not read or revealed. The extension displays source expressions, such as `process.env.SMTP_HOST?.trim() || undefined`, not the resolved value.

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
