import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  API_OWNERSHIP_REGISTRY_KIND,
  YTBM_API_OWNERSHIP_REGISTRY,
} from '../../src/renderer/src/platform/api-ownership-registry';

const preloadPath = resolve(process.cwd(), 'apps/desktop/src/preload/index.ts');
const preloadSource = ts.createSourceFile(
  preloadPath,
  readFileSync(preloadPath, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function propertyName(node: ts.NamedDeclaration): string {
  if (node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
    return node.name.text;
  }
  throw new Error('The preload API contains an unsupported computed method name.');
}

function preloadInterfaceMethods(): string[] {
  const declaration = preloadSource.statements.find(
    (statement) =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'YouTubeBackupManagerApi',
  );
  if (declaration === undefined || !ts.isInterfaceDeclaration(declaration)) {
    throw new Error('YouTubeBackupManagerApi was not found in the preload source.');
  }
  return declaration.members.map(propertyName);
}

function exposedPreloadObjectMethods(): string[] {
  for (const statement of preloadSource.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === 'api',
    );
    if (declaration === undefined || declaration.initializer === undefined) continue;
    const initializer = declaration.initializer;
    if (!ts.isCallExpression(initializer)) break;
    const objectArgument = initializer.arguments[0];
    if (objectArgument === undefined || !ts.isObjectLiteralExpression(objectArgument)) break;
    return objectArgument.properties.map(propertyName);
  }
  throw new Error('The frozen preload API object was not found in the preload source.');
}

describe('renderer API ownership registry', () => {
  it('is explicitly a non-normative migration inventory', () => {
    expect(API_OWNERSHIP_REGISTRY_KIND).toBe('non-normative migration inventory');
  });

  it('covers the exact method set declared and exposed by the preload source', () => {
    const registryMethods = Object.keys(YTBM_API_OWNERSHIP_REGISTRY).sort();
    expect(preloadInterfaceMethods().sort()).toEqual(registryMethods);
    expect(exposedPreloadObjectMethods().sort()).toEqual(registryMethods);
  });

  it('records a current caller, current feature, and single target owner for every method', () => {
    for (const ownership of Object.values(YTBM_API_OWNERSHIP_REGISTRY)) {
      expect(ownership.legacyCaller.length).toBeGreaterThan(0);
      expect(ownership.currentFeature.length).toBeGreaterThan(0);
      expect(ownership.targetOwner.length).toBeGreaterThan(0);
      expect(ownership.targetOwner).not.toContain('+');
    }
  });
});
