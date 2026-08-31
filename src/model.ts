import * as vscode from 'vscode';

export interface SourceLocation {
  uri: vscode.Uri;
  range: vscode.Range;
}

export interface ConfigKey {
  namespace: string;
  path: string;
  type: string;
  expression: string;
  location: SourceLocation;
}

export type UsageKind = 'ConfigService' | 'Typed injection' | 'Module registration';

export interface ConfigUsage {
  namespace: string;
  path?: string;
  kind: UsageKind;
  label: string;
  location: SourceLocation;
}

export interface ConfigNamespace {
  name: string;
  variableName: string;
  location: SourceLocation;
  keys: ConfigKey[];
  usages: ConfigUsage[];
}

export interface ConfigIndex {
  namespaces: Map<string, ConfigNamespace>;
}
