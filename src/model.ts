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

export type UsageKind = 'ConfigService' | 'Typed injection' | 'Module registration' | 'Factory invocation';

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

export type ModuleMemberKind = 'imports' | 'providers' | 'controllers' | 'exports';

export interface ModuleMember {
  kind: ModuleMemberKind;
  label: string;
  moduleName?: string;
  location: SourceLocation;
  /** Declaration in the imported local source file, when it can be resolved. */
  targetLocation?: SourceLocation;
}

export interface NestModule {
  name: string;
  location: SourceLocation;
  members: ModuleMember[];
  importedBy: SourceLocation[];
}

export interface ConfigIndex {
  namespaces: Map<string, ConfigNamespace>;
  modules: Map<string, NestModule>;
}
