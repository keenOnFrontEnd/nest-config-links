import * as ts from 'typescript';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { ConfigIndex, ConfigKey, ConfigNamespace, ModuleMemberKind, NestModule, SourceLocation } from './model';

const SOURCE_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
interface ParsedSource { uri: vscode.Uri; file: ts.SourceFile; }

export class NestConfigAnalyzer {
  async scan(): Promise<ConfigIndex> {
    const exclude = vscode.workspace.getConfiguration('nestConfigLinks').get<string[]>('exclude', []);
    const excluded = exclude.length ? `{${exclude.join(',')}}` : undefined;
    const matches = await Promise.all(SOURCE_GLOBS.map((glob) => vscode.workspace.findFiles(glob, excluded)));
    const files = [...new Map(matches.flat().map((uri) => [uri.toString(), uri])).values()];
    const index: ConfigIndex = { namespaces: new Map(), modules: new Map() };
    const readResults = await Promise.allSettled(files.map((uri) => this.readSource(uri)));
    const sources = readResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const sourceByPath = new Map(sources.map((source) => [normalizePath(source.uri.fsPath), source]));

    for (const source of sources) this.collectDeclarations(source.uri, source.file, index, sourceByPath);
    for (const source of sources) this.collectUsages(source.uri, source.file, index);
    this.linkModules(index);
    return index;
  }

  private async readSource(uri: vscode.Uri): Promise<ParsedSource> {
    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    const content = openDocument?.getText() ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    return { uri, file: ts.createSourceFile(uri.fsPath, content, ts.ScriptTarget.Latest, true) };
  }

  private collectDeclarations(uri: vscode.Uri, file: ts.SourceFile, index: ConfigIndex, sourceByPath: ReadonlyMap<string, ParsedSource>): void {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isRegisterAsCall(node.initializer)) {
        const namespaceArg = node.initializer.arguments[0];
        const factory = node.initializer.arguments[1];
        if (namespaceArg && ts.isStringLiteralLike(namespaceArg) && factory && isObjectReturningFactory(factory)) {
          const name = namespaceArg.text;
          const object = returnedObject(factory);
          if (object) {
            const namespace: ConfigNamespace = {
              name,
              variableName: node.name.text,
              location: location(uri, file, node.name),
              keys: [],
              usages: [],
            };
            collectObjectKeys(uri, file, name, object, '', namespace.keys, localBindings(factory));
            index.namespaces.set(name, namespace);
          }
        }
      }
      if (ts.isClassDeclaration(node) && node.name) this.collectNestModule(uri, file, node, index, sourceByPath);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  private collectNestModule(
    uri: vscode.Uri,
    file: ts.SourceFile,
    node: ts.ClassDeclaration,
    index: ConfigIndex,
    sourceByPath: ReadonlyMap<string, ParsedSource>,
  ): void {
    const decorator = ts.getDecorators(node)?.find(isModuleDecorator);
    if (!decorator || !ts.isCallExpression(decorator.expression) || !node.name) return;
    const options = decorator.expression.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return;
    const module: NestModule = { name: node.name.text, location: location(uri, file, node.name), members: [], importedBy: [] };
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) continue;
      const kind = propertyName(property.name) as ModuleMemberKind | undefined;
      if (!kind || !['imports', 'providers', 'controllers', 'exports'].includes(kind)) continue;
      for (const element of property.initializer.elements) {
        const memberName = ts.isIdentifier(element) ? element.text : undefined;
        module.members.push({
          kind,
          label: element.getText(file),
          moduleName: memberName,
          location: location(uri, file, element),
          targetLocation: memberName ? importedSymbolLocation(uri, file, memberName, sourceByPath) : undefined,
        });
      }
    }
    index.modules.set(module.name, module);
  }

  private linkModules(index: ConfigIndex): void {
    for (const source of index.modules.values()) {
      for (const member of source.members) {
        if (member.kind !== 'imports' || !member.moduleName) continue;
        index.modules.get(member.moduleName)?.importedBy.push(source.location);
      }
    }
  }

  private collectUsages(uri: vscode.Uri, file: ts.SourceFile, index: ConfigIndex): void {
    const visit = (node: ts.Node): void => {
      const configKey = configServiceKey(node);
      if (configKey) this.addConfigServiceUsage(uri, file, node, configKey, index);
      if (ts.isTypeReferenceNode(node)) this.addTypedUsage(uri, file, node, index);
      if (ts.isPropertyAccessExpression(node)) this.addInjectionTokenUsage(uri, file, node, index);
      if (ts.isCallExpression(node)) this.addFactoryInvocation(uri, file, node, index);
      if (ts.isCallExpression(node) && isConfigModuleRegistration(node)) this.addModuleRegistration(uri, file, node, index);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  private addConfigServiceUsage(uri: vscode.Uri, file: ts.SourceFile, node: ts.Node, key: string, index: ConfigIndex): void {
    const [namespace, ...rest] = key.split('.');
    const entry = index.namespaces.get(namespace);
    if (!entry) return;
    const path = rest.join('.');
    entry.usages.push({ namespace, path, kind: 'ConfigService', label: `ConfigService.get('${key}')`, location: location(uri, file, node) });
  }

  private addTypedUsage(uri: vscode.Uri, file: ts.SourceFile, node: ts.TypeReferenceNode, index: ConfigIndex): void {
    if (!ts.isIdentifier(node.typeName) || node.typeName.text !== 'ConfigType') return;
    const argument = node.typeArguments?.[0];
    if (!argument || !ts.isTypeQueryNode(argument) || !ts.isIdentifier(argument.exprName)) return;
    for (const entry of index.namespaces.values()) {
      if (entry.variableName === argument.exprName.text) {
        entry.usages.push({ namespace: entry.name, kind: 'Typed injection', label: `ConfigType<typeof ${entry.variableName}>`, location: location(uri, file, node) });
      }
    }
  }

  private addInjectionTokenUsage(uri: vscode.Uri, file: ts.SourceFile, node: ts.PropertyAccessExpression, index: ConfigIndex): void {
    if (node.name.text !== 'KEY' || !ts.isIdentifier(node.expression)) return;
    for (const entry of index.namespaces.values()) {
      if (entry.variableName === node.expression.text) {
        entry.usages.push({ namespace: entry.name, kind: 'Typed injection', label: `@Inject(${entry.variableName}.KEY)`, location: location(uri, file, node) });
      }
    }
  }

  private addFactoryInvocation(uri: vscode.Uri, file: ts.SourceFile, node: ts.CallExpression, index: ConfigIndex): void {
    if (!ts.isIdentifier(node.expression)) return;
    for (const entry of index.namespaces.values()) {
      if (entry.variableName === node.expression.text) {
        entry.usages.push({ namespace: entry.name, kind: 'Factory invocation', label: `${entry.variableName}()`, location: location(uri, file, node) });
      }
    }
  }

  private addModuleRegistration(uri: vscode.Uri, file: ts.SourceFile, node: ts.CallExpression, index: ConfigIndex): void {
    const options = node.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return;
    const load = options.properties.find((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === 'load',
    );
    if (!load || !ts.isArrayLiteralExpression(load.initializer)) return;
    for (const element of load.initializer.elements) {
      if (!ts.isIdentifier(element)) continue;
      for (const entry of index.namespaces.values()) {
        if (entry.variableName === element.text) {
          entry.usages.push({
            namespace: entry.name,
            kind: 'Module registration',
            label: 'ConfigModule.forRoot({ load: [...] })',
            location: location(uri, file, element),
          });
        }
      }
    }
  }
}

function importedSymbolLocation(
  sourceUri: vscode.Uri,
  file: ts.SourceFile,
  localName: string,
  sourceByPath: ReadonlyMap<string, ParsedSource>,
): SourceLocation | undefined {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const imported = importedName(statement.importClause, localName);
    if (!imported) continue;
    const target = resolveRelativeImport(sourceUri, statement.moduleSpecifier.text, sourceByPath);
    if (!target) continue;
    const declaration = findExportedDeclaration(target.file, imported);
    return declaration ? location(target.uri, target.file, declaration) : { uri: target.uri, range: new vscode.Range(0, 0, 0, 0) };
  }
  return undefined;
}

function importedName(clause: ts.ImportClause | undefined, localName: string): string | undefined {
  if (!clause) return undefined;
  if (clause.name?.text === localName) return 'default';
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return undefined;
  const element = bindings.elements.find((item) => item.name.text === localName);
  return element ? (element.propertyName?.text ?? element.name.text) : undefined;
}

function resolveRelativeImport(
  sourceUri: vscode.Uri,
  specifier: string,
  sourceByPath: ReadonlyMap<string, ParsedSource>,
): ParsedSource | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(sourceUri.fsPath), specifier);
  const candidates = [
    base,
    base.replace(/\.(?:[cm]?js|jsx)$/, '.ts'),
    base.replace(/\.(?:[cm]?js|jsx)$/, '.tsx'),
    ...['.ts', '.tsx', '.mts', '.cts'].map((extension) => `${base}${extension}`),
    ...['index.ts', 'index.tsx', 'index.mts', 'index.cts'].map((name) => path.join(base, name)),
  ];
  return candidates.map((candidate) => sourceByPath.get(normalizePath(candidate))).find(Boolean);
}

function findExportedDeclaration(file: ts.SourceFile, name: string): ts.Identifier | undefined {
  for (const statement of file.statements) {
    if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) && hasExportModifier(statement)) {
      if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name?.text === name) return statement.name;
      if (ts.isVariableStatement(statement)) {
        const declaration = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === name);
        if (declaration && ts.isIdentifier(declaration.name)) return declaration.name;
      }
    }
  }
  return undefined;
}

function hasExportModifier(node: ts.HasModifiers): boolean {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function normalizePath(value: string): string {
  return path.normalize(value);
}

function isRegisterAsCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'registerAs';
}

function isModuleDecorator(decorator: ts.Decorator): boolean {
  return ts.isCallExpression(decorator.expression) && ts.isIdentifier(decorator.expression.expression) && decorator.expression.expression.text === 'Module';
}

function isObjectReturningFactory(node: ts.Expression): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function returnedObject(factory: ts.ArrowFunction | ts.FunctionExpression): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(factory.body)) return factory.body;
  // `() => ({ key: value })` — найпоширеніша форма `registerAs`, але в AST
  // обʼєкт обгорнутий у ParenthesizedExpression. Без розгортання тут губились
  // всі такі namespace-и (на відміну від `() => { return { ... } }`).
  if (ts.isParenthesizedExpression(factory.body) && ts.isObjectLiteralExpression(factory.body.expression)) {
    return factory.body.expression;
  }
  if (!ts.isBlock(factory.body)) return undefined;
  const returned = factory.body.statements.find(ts.isReturnStatement);
  return returned?.expression && ts.isObjectLiteralExpression(returned.expression) ? returned.expression : undefined;
}

function collectObjectKeys(
  uri: vscode.Uri,
  file: ts.SourceFile,
  namespace: string,
  object: ts.ObjectLiteralExpression,
  prefix: string,
  output: ConfigKey[],
  bindings: ReadonlyMap<string, string>,
): void {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      collectObjectKeys(uri, file, namespace, property.initializer, path, output, bindings);
    } else {
      output.push({
        namespace,
        path,
        type: ts.isIdentifier(property.initializer) ? (bindings.get(property.initializer.text) ?? 'unknown') : inferType(property.initializer),
        expression: property.initializer.getText(file),
        location: location(uri, file, property.name),
      });
    }
  }
}

function localBindings(factory: ts.ArrowFunction | ts.FunctionExpression): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  if (!ts.isBlock(factory.body)) return bindings;
  for (const statement of factory.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) bindings.set(declaration.name.text, inferType(declaration.initializer));
    }
  }
  return bindings;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

function inferType(expression: ts.Expression): string {
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
  if (ts.isNumericLiteral(expression)) return 'number';
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return 'string';
  const text = expression.getText();
  if (/Number\.parse|parseInt|parseFloat|positiveInt|Number\(/.test(text)) return 'number';
  if (/\.toUpperCase\(|\.trim\(/.test(text)) return /undefined|null/.test(text) ? 'string | undefined' : 'string';
  if (/undefined|null/.test(text)) return 'unknown | undefined';
  return 'unknown';
}

function configServiceKey(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!['get', 'getOrThrow'].includes(node.expression.name.text)) return undefined;
  const first = node.arguments[0];
  return first && ts.isStringLiteralLike(first) ? first.text : undefined;
}

function isConfigModuleRegistration(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ConfigModule' && node.expression.name.text === 'forRoot';
}

function location(uri: vscode.Uri, file: ts.SourceFile, node: ts.Node): SourceLocation {
  const start = file.getLineAndCharacterOfPosition(node.getStart(file));
  const end = file.getLineAndCharacterOfPosition(node.getEnd());
  return { uri, range: new vscode.Range(start.line, start.character, end.line, end.character) };
}
