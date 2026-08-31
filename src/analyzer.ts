import * as ts from 'typescript';
import * as vscode from 'vscode';
import { ConfigIndex, ConfigKey, ConfigNamespace, SourceLocation } from './model';

const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts}';

export class NestConfigAnalyzer {
  async scan(): Promise<ConfigIndex> {
    const exclude = vscode.workspace.getConfiguration('nestConfigLinks').get<string[]>('exclude', []);
    const excluded = exclude.length ? `{${exclude.join(',')}}` : undefined;
    const files = await vscode.workspace.findFiles(SOURCE_GLOB, excluded);
    const index: ConfigIndex = { namespaces: new Map() };
    const sources = await Promise.all(files.map((uri) => this.readSource(uri)));

    for (const source of sources) this.collectDeclarations(source.uri, source.file, index);
    for (const source of sources) this.collectUsages(source.uri, source.file, index);
    return index;
  }

  private async readSource(uri: vscode.Uri): Promise<{ uri: vscode.Uri; file: ts.SourceFile }> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { uri, file: ts.createSourceFile(uri.fsPath, Buffer.from(bytes).toString('utf8'), ts.ScriptTarget.Latest, true) };
  }

  private collectDeclarations(uri: vscode.Uri, file: ts.SourceFile, index: ConfigIndex): void {
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
      ts.forEachChild(node, visit);
    };
    visit(file);
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

function isRegisterAsCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'registerAs';
}

function isObjectReturningFactory(node: ts.Expression): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function returnedObject(factory: ts.ArrowFunction | ts.FunctionExpression): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(factory.body)) return factory.body;
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
