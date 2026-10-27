/**
 * Parser GraphQL TỐI GIẢN cho demo hybridLink (không phụ thuộc thư viện `graphql`).
 * Hỗ trợ: query/mutation, tên operation, khai báo biến, alias, tham số ($biến hoặc literal),
 * directive không tham số (@naptime), selection lồng nhau. Không hỗ trợ fragment, list/object literal.
 * Dự án thật: dùng `gql` của graphql-tag / @apollo/client.
 */

export type ArgValue =
  | { kind: 'variable'; name: string }
  | { kind: 'literal'; value: string | number | boolean | null };

export interface FieldNode {
  name: string;
  alias?: string;
  args: Record<string, ArgValue>;
  directives: string[];
  selections: FieldNode[];
}

export interface DocumentNode {
  operation: 'query' | 'mutation';
  name?: string;
  /** tên các biến đã khai báo, không có dấu $ */
  variables: string[];
  selections: FieldNode[];
  /** chuỗi gốc, gửi nguyên lên server GraphQL */
  source: string;
}

const TOKEN =
  /\s+|#[^\n]*|,|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|\.\.\.|[{}():$@!=[\]]/gy;

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) throw new SyntaxError(`ký tự không hợp lệ ở vị trí ${start}: "${source[start]}"`);
    const text = match[0];
    if (/^\s|^#|^,$/.test(text)) continue; // khoảng trắng, comment, dấu phẩy đều bị GraphQL bỏ qua
    tokens.push(text);
  }
  return tokens;
}

export function parse(source: string): DocumentNode {
  const tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => {
    if (i >= tokens.length) throw new SyntaxError('hết chuỗi bất ngờ');
    return tokens[i++];
  };
  const expect = (text: string) => {
    const token = next();
    if (token !== text) throw new SyntaxError(`cần "${text}", gặp "${token}"`);
  };

  function value(): ArgValue {
    const token = next();
    if (token === '$') return { kind: 'variable', name: next() };
    if (token.startsWith('"')) return { kind: 'literal', value: JSON.parse(token) as string };
    if (/^-?\d/.test(token)) return { kind: 'literal', value: Number(token) };
    if (token === 'true' || token === 'false') return { kind: 'literal', value: token === 'true' };
    if (token === 'null') return { kind: 'literal', value: null };
    throw new SyntaxError(`giá trị không hỗ trợ: "${token}"`);
  }

  function selectionSet(): FieldNode[] {
    expect('{');
    const fields: FieldNode[] = [];
    while (peek() !== '}') {
      if (peek() === '...') throw new SyntaxError('fragment chưa được hỗ trợ');
      let name = next();
      let alias: string | undefined;
      if (peek() === ':') {
        next();
        alias = name;
        name = next();
      }
      const args: Record<string, ArgValue> = {};
      if (peek() === '(') {
        next();
        while (peek() !== ')') {
          const argName = next();
          expect(':');
          args[argName] = value();
        }
        next();
      }
      const directives: string[] = [];
      while (peek() === '@') {
        next();
        directives.push(next());
      }
      const selections = peek() === '{' ? selectionSet() : [];
      fields.push({ name, alias, args, directives, selections });
    }
    next();
    return fields;
  }

  let operation: DocumentNode['operation'] = 'query';
  let name: string | undefined;
  const variables: string[] = [];
  if (peek() === 'query' || peek() === 'mutation') {
    operation = next() as DocumentNode['operation'];
    if (peek() !== '(' && peek() !== '{') name = next();
    if (peek() === '(') {
      // ($slug: String!, $limit: Int = 10): chỉ cần tên biến, bỏ qua kiểu và giá trị mặc định
      next();
      while (peek() !== ')') {
        if (next() === '$') variables.push(next());
      }
      next();
    }
  }
  const selections = selectionSet();
  if (i !== tokens.length) throw new SyntaxError('chỉ hỗ trợ một operation mỗi document');
  return { operation, name, variables, selections, source };
}

/** Template tag giống graphql-tag: gql`query { … }` */
export function gql(strings: TemplateStringsArray, ...values: unknown[]): DocumentNode {
  return parse(
    strings.reduce((out, s, k) => out + s + (k < values.length ? String(values[k]) : ''), ''),
  );
}
