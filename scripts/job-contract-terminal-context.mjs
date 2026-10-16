import ts from 'typescript';

export function getCallArguments(source, functionName) {
  const calls = [];
  const callPattern = new RegExp(`\\b${functionName}\\s*\\(`, 'g');

  for (const match of source.matchAll(callPattern)) {
    const openingParen = source.indexOf('(', match.index);
    let parentheses = 1;
    let braces = 0;
    let brackets = 0;
    let quote = null;
    let escaped = false;
    let argumentStart = openingParen + 1;
    const args = [];

    for (let index = openingParen + 1; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '/' && next === '/') {
        const newline = source.indexOf('\n', index + 2);
        index = newline === -1 ? source.length : newline;
        continue;
      }
      if (char === '/' && next === '*') {
        const commentEnd = source.indexOf('*/', index + 2);
        index = commentEnd === -1 ? source.length : commentEnd + 1;
        continue;
      }

      if (char === '(') parentheses += 1;
      else if (char === ')') {
        parentheses -= 1;
        if (parentheses === 0) {
          args.push(source.slice(argumentStart, index).trim());
          calls.push(args);
          break;
        }
      } else if (char === '{') braces += 1;
      else if (char === '}') braces -= 1;
      else if (char === '[') brackets += 1;
      else if (char === ']') brackets -= 1;
      else if (char === ',' && parentheses === 1 && braces === 0 && brackets === 0) {
        args.push(source.slice(argumentStart, index).trim());
        argumentStart = index + 1;
      }
    }
  }

  return calls;
}

export function validateWorkStatusCompletion(source, route) {
  const sourceFile = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const completionCalls = [];
  const visit = (node, callback) => {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  };
  visit(sourceFile, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'logJobResult') {
      completionCalls.push(node);
    }
  });

  const failures = [];
  const allowedStatuses = new Set(['empty', 'worked', 'unknown']);
  const outputLiterals = (expression) => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) return outputLiterals(expression.expression);
    if (ts.isConditionalExpression(expression)) {
      return [
        ...outputLiterals(expression.whenTrue),
        ...outputLiterals(expression.whenFalse),
      ];
    }
    return ts.isStringLiteral(expression) ? [expression] : [];
  };
  for (const call of completionCalls) {
    const extra = call.arguments[3];
    const properties = extra && ts.isObjectLiteralExpression(extra) ? extra.properties : [];
    const statusProperty = properties.find((property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ts.isIdentifier(property.name) && property.name.text === 'workStatus');
    if (!statusProperty) {
      failures.push(`${route} não classifica o trabalho concluído em logJobResult (workStatus).`);
      continue;
    }

    if (ts.isPropertyAssignment(statusProperty)) {
      for (const literal of outputLiterals(statusProperty.initializer)) {
        if (!allowedStatuses.has(literal.text)) {
          failures.push(`${route} usa workStatus inválido "${literal.text}"; use empty, worked ou unknown.`);
        }
      }
    }
  }

  if (completionCalls.length === 0) {
    failures.push(`${route} não classifica o trabalho concluído em logJobResult (workStatus).`);
  }
  return failures;
}

export function validateTerminalContext(source, route) {
  const sourceFile = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const startContexts = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'startJobRun') {
      startContexts.push(node.name.text);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) && ts.isCallExpression(node.right) &&
      ts.isIdentifier(node.right.expression) && node.right.expression.text === 'startJobRun') {
      startContexts.push(node.left.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const failures = [];

  if (startContexts.length !== 1) {
    failures.push(`${route} deve ter exatamente um contexto retornado por startJobRun().`);
    return failures;
  }

  for (const functionName of ['logJobResult', 'logJobFailure']) {
    for (const args of getCallArguments(source, functionName)) {
      const context = args[1];
      if (!context) {
        failures.push(`${route} chama ${functionName} sem contexto de execução.`);
      } else if (!/^[A-Za-z_$][\w$]*$/.test(context)) {
        failures.push(`${route} deve passar o contexto de execução diretamente a ${functionName}.`);
      } else if (context !== startContexts[0]) {
        failures.push(`${route} passa contexto divergente a ${functionName}; esperado ${startContexts[0]}.`);
      }
    }
  }

  return failures;
}
export function validateGlobalCronAuth(source, route) {
  const sourceFile = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures = [];
  const visit = (node, callback) => {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  };
  const propertyName = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : null;
  const stringArgument = (call) => call.arguments?.[0] && ts.isStringLiteral(call.arguments[0])
    ? call.arguments[0].text
    : null;
  const hasHeaderGet = (node, headerName) => {
    let found = false;
    visit(node, (child) => {
      if (
        ts.isCallExpression(child) &&
        propertyName(child.expression) === 'get' &&
        stringArgument(child) === headerName &&
        ts.isPropertyAccessExpression(child.expression) &&
        propertyName(child.expression.expression) === 'headers'
      ) found = true;
    });
    return found;
  };
  const declarations = new Map();
  visit(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, node.initializer);
    }
  });
  const configuredToken = declarations.get('configuredCronToken');
  let readsConfiguredSecret = false;
  if (configuredToken) {
    visit(configuredToken, (node) => {
      if (ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'process' &&
        node.expression.name.text === 'env' &&
        ['CRON_SECRET', 'CRON_SECRET_TOKEN'].includes(node.name.text)) {
        readsConfiguredSecret = true;
      }
    });
  }
  const readsCronToken = hasHeaderGet(declarations.get('cronToken') ?? sourceFile, 'x-cron-token');
  const readsBearerToken = hasHeaderGet(declarations.get('bearerToken') ?? sourceFile, 'authorization');

  const compareWithConfigured = (expression, tokenName) => {
    let matches = false;
    visit(expression, (node) => {
      if (!ts.isBinaryExpression(node) ||
        ![ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) return;
      const pair = [node.left, node.right].map((part) => ts.isIdentifier(part) ? part.text : null);
      if (pair.includes(tokenName) && pair.includes('configuredCronToken')) matches = true;
    });
    return matches;
  };
  const hasPairedTokenMismatch = (condition) => {
    let paired = false;
    visit(condition, (node) => {
      if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return;
      if (compareWithConfigured(node, 'cronToken') && compareWithConfigured(node, 'bearerToken')) paired = true;
    });
    return paired;
  };
  const hasMissingConfiguredTokenGuard = (condition) => {
    let guarded = false;
    visit(condition, (node) => {
      if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.BarBarToken) return;
      let missingConfiguredToken = false;
      visit(node.left, (child) => {
        if (ts.isPrefixUnaryExpression(child) && child.operator === ts.SyntaxKind.ExclamationToken &&
          ts.isIdentifier(child.operand) && child.operand.text === 'configuredCronToken') {
          missingConfiguredToken = true;
        }
      });
      if (missingConfiguredToken && hasPairedTokenMismatch(node.right)) guarded = true;
    });
    return guarded;
  };
  const rejectsWith401 = (statement) => {
    const isUnauthorizedReturn = (node) => {
      if (!ts.isReturnStatement(node) || !node.expression || !ts.isCallExpression(node.expression)) return false;
      const responseCall = node.expression;
      if (!ts.isPropertyAccessExpression(responseCall.expression) ||
        responseCall.expression.name.text !== 'json' ||
        !ts.isIdentifier(responseCall.expression.expression) ||
        responseCall.expression.expression.text !== 'NextResponse') return false;
      const options = responseCall.arguments[1];
      if (!options || !ts.isObjectLiteralExpression(options)) return false;
      return options.properties.some((property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) && property.name.text === 'status' &&
        ts.isNumericLiteral(property.initializer) && Number(property.initializer.text) === 401);
    };
    const directStatements = ts.isBlock(statement) ? statement.statements : [statement];
    return directStatements.some(isUnauthorizedReturn);
  };
  let hasGuardedUnauthorizedReturn = false;
  visit(sourceFile, (node) => {
    if (!ts.isIfStatement(node)) return;
    const condition = node.expression;
    if (
      readsConfiguredSecret && readsCronToken && readsBearerToken &&
      compareWithConfigured(condition, 'cronToken') &&
      compareWithConfigured(condition, 'bearerToken') &&
      hasMissingConfiguredTokenGuard(condition) &&
      rejectsWith401(node.thenStatement)
    ) hasGuardedUnauthorizedReturn = true;
  });

  if (!hasGuardedUnauthorizedReturn) {
    failures.push(`${route} está classificada global, mas não verifica CRON_SECRET contra os headers e rejeita credenciais inválidas com 401.`);
  }
  return failures;
}
