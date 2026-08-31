import * as vscode from 'vscode';
import { ConfigIndex, ConfigKey, ConfigNamespace, ConfigUsage, ModuleMember, ModuleMemberKind, NestModule, SourceLocation } from './model';

type Element = RootElement | NamespaceElement | KeyElement | UsageElement | GroupElement | ModuleElement | ModuleGroupElement | ModuleMemberElement | ImportedByElement;

class RootElement {
  constructor(readonly kind: 'configs' | 'modules') {}
}

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

class ModuleElement {
  constructor(readonly module: NestModule) {}
}

class ModuleGroupElement {
  constructor(readonly kind: ModuleMemberKind, readonly members: ModuleMember[]) {}
}

class ModuleMemberElement {
  constructor(readonly member: ModuleMember) {}
}

class ImportedByElement {
  constructor(readonly location: SourceLocation) {}
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<Element> {
  private readonly changed = new vscode.EventEmitter<Element | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private index: ConfigIndex = { namespaces: new Map(), modules: new Map() };

  setIndex(index: ConfigIndex): void {
    this.index = index;
    this.changed.fire(undefined);
  }

  getTreeItem(element: Element): vscode.TreeItem {
    if (element instanceof RootElement) {
      const item = new vscode.TreeItem(element.kind === 'configs' ? 'Configuration' : 'Nest Modules', vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(element.kind === 'configs' ? 'settings-gear' : 'package');
      return item;
    }
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
    if (element instanceof ModuleElement) {
      const item = new vscode.TreeItem(element.module.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${element.module.members.length} members · imported by ${element.module.importedBy.length}`;
      item.iconPath = new vscode.ThemeIcon('package');
      item.command = openCommand(element.module.location);
      return item;
    }
    if (element instanceof ModuleGroupElement) {
      const item = new vscode.TreeItem(element.kind, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(element.members.length);
      item.iconPath = new vscode.ThemeIcon(element.kind === 'controllers' ? 'symbol-method' : 'symbol-class');
      return item;
    }
    if (element instanceof ModuleMemberElement) {
      const item = new vscode.TreeItem(element.member.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-reference');
      item.command = openCommand(element.member.location);
      return item;
    }
    if (element instanceof ImportedByElement) {
      const item = new vscode.TreeItem('Imported by module', vscode.TreeItemCollapsibleState.None);
      item.description = vscode.workspace.asRelativePath(element.location.uri);
      item.iconPath = new vscode.ThemeIcon('arrow-up');
      item.command = openCommand(element.location);
      return item;
    }
    const item = new vscode.TreeItem(element.usage.label, vscode.TreeItemCollapsibleState.None);
    item.description = vscode.workspace.asRelativePath(element.usage.location.uri);
    item.iconPath = new vscode.ThemeIcon(element.usage.kind === 'Module registration' ? 'package' : 'symbol-reference');
    item.command = openCommand(element.usage.location);
    return item;
  }

  getChildren(element?: Element): Element[] {
    if (!element) return [new RootElement('configs'), new RootElement('modules')];
    if (element instanceof RootElement) {
      return element.kind === 'configs'
        ? [...this.index.namespaces.values()].sort(byName).map((config) => new NamespaceElement(config))
        : [...this.index.modules.values()].sort((a, b) => a.name.localeCompare(b.name)).map((module) => new ModuleElement(module));
    }
    if (element instanceof NamespaceElement) {
      return [...element.config.keys.sort(byPath).map((key) => new KeyElement(key)), new GroupElement('All usages', element.config.usages)];
    }
    if (element instanceof KeyElement) {
      return this.index.namespaces.get(element.key.namespace)?.usages.filter((usage) => usage.path === element.key.path).map((usage) => new UsageElement(usage)) ?? [];
    }
    if (element instanceof GroupElement) return element.usages.map((usage) => new UsageElement(usage));
    if (element instanceof ModuleElement) {
      const groups = (['imports', 'providers', 'controllers', 'exports'] as const)
        .map((kind) => new ModuleGroupElement(kind, element.module.members.filter((member) => member.kind === kind)))
        .filter((group) => group.members.length > 0);
      const incoming = element.module.importedBy.map((location) => new ImportedByElement(location));
      return [...groups, ...incoming];
    }
    if (element instanceof ModuleGroupElement) return element.members.map((member) => new ModuleMemberElement(member));
    return [];
  }
}

function byName(a: ConfigNamespace, b: ConfigNamespace): number { return a.name.localeCompare(b.name); }
function byPath(a: ConfigKey, b: ConfigKey): number { return a.path.localeCompare(b.path); }
function openCommand(location: SourceLocation): vscode.Command { return { command: 'vscode.open', title: 'Open', arguments: [location.uri, { selection: location.range }] }; }
