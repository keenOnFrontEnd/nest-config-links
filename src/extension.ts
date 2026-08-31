import * as vscode from 'vscode';
import { NestConfigAnalyzer } from './analyzer';
import { ConfigIndex, ConfigNamespace } from './model';
import { ConfigTreeProvider } from './tree';

export function activate(context: vscode.ExtensionContext): void {
  const analyzer = new NestConfigAnalyzer();
  const tree = new ConfigTreeProvider();
  let index: ConfigIndex = { namespaces: new Map() };

  const refresh = async (): Promise<void> => {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Nest Config Links: scanning workspace' }, async () => {
      index = await analyzer.scan();
      tree.setIndex(index);
    });
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('nestConfigLinks.explorer', tree),
    vscode.commands.registerCommand('nestConfigLinks.refresh', refresh),
    vscode.commands.registerCommand('nestConfigLinks.showForConfig', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const config = configAtPosition(editor.document, editor.selection.active, index);
      if (!config) {
        void vscode.window.showInformationMessage('Nest Config Links: place the cursor on a registerAs namespace or config key.');
        return;
      }
      await vscode.commands.executeCommand('workbench.view.extension.nestConfigLinks');
      await vscode.commands.executeCommand('nestConfigLinks.explorer.focus');
    }),
    vscode.languages.registerCodeLensProvider([{ language: 'typescript' }, { language: 'typescriptreact' }], new ConfigCodeLensProvider(() => index)),
    vscode.languages.registerCompletionItemProvider([{ language: 'typescript' }, { language: 'typescriptreact' }], new ConfigCompletionProvider(() => index), "'", '"'),
    vscode.languages.registerHoverProvider([{ language: 'typescript' }, { language: 'typescriptreact' }], new ConfigHoverProvider(() => index)),
    vscode.workspace.onDidSaveTextDocument((document) => { if (/\.(ts|tsx|mts|cts)$/.test(document.fileName)) void refresh(); }),
  );
  void refresh();
}

export function deactivate(): void {}

class ConfigCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly getIndex: () => ConfigIndex) {}
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (const config of this.getIndex().namespaces.values()) {
      if (config.location.uri.toString() !== document.uri.toString()) continue;
      lenses.push(new vscode.CodeLens(config.location.range, { command: 'nestConfigLinks.showForConfig', title: `Nest Config: ${config.usages.length} usages` }));
    }
    return lenses;
  }
}

class ConfigCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getIndex: () => ConfigIndex) {}
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    const match = /(?:get|getOrThrow)(?:<[^>]+>)?\(\s*['"]([^'"]*)$/.exec(prefix);
    if (!match) return [];
    const typed = match[1];
    const [namespace] = typed.split('.');
    const configs = namespace ? [this.getIndex().namespaces.get(namespace)].filter(Boolean) as ConfigNamespace[] : [...this.getIndex().namespaces.values()];
    return configs.flatMap((config) => config.keys.map((key) => {
      const item = new vscode.CompletionItem(`${config.name}.${key.path}`, vscode.CompletionItemKind.Property);
      item.detail = key.type;
      item.documentation = new vscode.MarkdownString(`\`${key.expression}\``);
      item.insertText = `${config.name}.${key.path}`;
      return item;
    }));
  }
}

class ConfigHoverProvider implements vscode.HoverProvider {
  constructor(private readonly getIndex: () => ConfigIndex) {}
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/);
    if (!range) return undefined;
    const key = document.getText(range);
    const dot = key.indexOf('.');
    if (dot < 1) return undefined;
    const config = this.getIndex().namespaces.get(key.slice(0, dot));
    const property = config?.keys.find((entry) => `${entry.namespace}.${entry.path}` === key);
    if (!property) return undefined;
    const usages = config?.usages.filter((usage) => usage.path === property.path).length ?? 0;
    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(`${key}: ${property.type}`, 'typescript');
    markdown.appendMarkdown(`Source: \`${property.expression}\`  \n${usages} usage${usages === 1 ? '' : 's'} in workspace.`);
    return new vscode.Hover(markdown, range);
  }
}

function configAtPosition(document: vscode.TextDocument, position: vscode.Position, index: ConfigIndex): ConfigNamespace | undefined {
  for (const config of index.namespaces.values()) {
    if (config.location.uri.toString() === document.uri.toString() && config.location.range.contains(position)) return config;
  }
  const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/);
  const text = range ? document.getText(range) : '';
  return index.namespaces.get(text.split('.')[0]);
}
