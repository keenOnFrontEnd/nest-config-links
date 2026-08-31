import * as vscode from 'vscode';
import { ConfigIndex, ConfigKey, ConfigNamespace, ConfigUsage, SourceLocation } from './model';

type Element = NamespaceElement | KeyElement | UsageElement | GroupElement;

class NamespaceElement {
  constructor(readonly config: ConfigNamespace) {}
}

class KeyElement {
  constructor(readonly key: ConfigKey) {}
}

class UsageElement {
  constructor(readonly usage: ConfigUsage) {}
}

class GroupElement {
  constructor(readonly label: string, readonly usages: ConfigUsage[]) {}
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<Element> {
  private readonly changed = new vscode.EventEmitter<Element | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private index: ConfigIndex = { namespaces: new Map() };

  setIndex(index: ConfigIndex): void {
    this.index = index;
    this.changed.fire(undefined);
  }

  getTreeItem(element: Element): vscode.TreeItem {
    if (element instanceof NamespaceElement) {
      const item = new vscode.TreeItem(element.config.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${element.config.keys.length} keys · ${element.config.usages.length} usages`;
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      item.command = openCommand(element.config.location);
      return item;
    }
    if (element instanceof KeyElement) {
      const item = new vscode.TreeItem(element.key.path, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = element.key.type;
      item.tooltip = `${element.key.namespace}.${element.key.path}\n${element.key.expression}`;
      item.iconPath = new vscode.ThemeIcon('symbol-property');
      item.command = openCommand(element.key.location);
      return item;
    }
    if (element instanceof GroupElement) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(element.usages.length);
      item.iconPath = new vscode.ThemeIcon('references');
      return item;
    }
    const item = new vscode.TreeItem(element.usage.label, vscode.TreeItemCollapsibleState.None);
    item.description = vscode.workspace.asRelativePath(element.usage.location.uri);
    item.iconPath = new vscode.ThemeIcon(element.usage.kind === 'Module registration' ? 'package' : 'symbol-reference');
    item.command = openCommand(element.usage.location);
    return item;
  }

  getChildren(element?: Element): Element[] {
    if (!element) return [...this.index.namespaces.values()].sort(byName).map((config) => new NamespaceElement(config));
    if (element instanceof NamespaceElement) {
      return [...element.config.keys.sort(byPath).map((key) => new KeyElement(key)), new GroupElement('All usages', element.config.usages)];
    }
    if (element instanceof KeyElement) {
      return this.index.namespaces.get(element.key.namespace)?.usages.filter((usage) => usage.path === element.key.path).map((usage) => new UsageElement(usage)) ?? [];
    }
    if (element instanceof GroupElement) return element.usages.map((usage) => new UsageElement(usage));
    return [];
  }
}

function byName(a: ConfigNamespace, b: ConfigNamespace): number { return a.name.localeCompare(b.name); }
function byPath(a: ConfigKey, b: ConfigKey): number { return a.path.localeCompare(b.path); }
function openCommand(location: SourceLocation): vscode.Command { return { command: 'vscode.open', title: 'Open', arguments: [location.uri, { selection: location.range }] }; }
