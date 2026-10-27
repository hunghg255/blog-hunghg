import {
  Component,
  createElement,
  Fragment,
  useEffect,
  useMemo,
  type ComponentType,
  type ReactNode,
} from 'react';

/**
 * Page behaviors: CMS khai báo cho mỗi trang một danh sách "hành vi" (exit-intent, style riêng,
 * banner…), code chỉ cần một registry `identifier -> component`. Mỗi behavior bọc quanh nội dung
 * trang như một lớp middleware. Ý tưởng từ `lib/page-behaviors/PageBehaviors.tsx` của intercom.com.
 */

/** Một entry như CMS trả về (Contentful: sys.id + fields.identifier + fields.configuration). */
export interface BehaviorEntry {
  id: string;
  identifier: string;
  configuration?: unknown;
}

export interface BehaviorProps<C> {
  /** id của entry trong CMS: dùng làm khoá lưu trữ riêng cho từng instance */
  id: string;
  config: C;
  children: ReactNode;
}

export interface BehaviorDefinition<C = unknown> {
  /** kiểm tra + chuẩn hoá cấu hình do người biên tập nhập; sai thì throw */
  parse?: (raw: unknown) => C;
  component: ComponentType<BehaviorProps<C>>;
}

/** Chỉ để TypeScript suy ra kiểu C từ parse cho component. */
export function defineBehavior<C>(definition: BehaviorDefinition<C>): BehaviorDefinition<C> {
  return definition;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BehaviorRegistry = Record<string, BehaviorDefinition<any>>;

export interface BehaviorIssue {
  id: string;
  identifier: string;
  reason: 'unknown' | 'invalid-config' | 'render-error';
  message: string;
}

export interface ResolvedBehavior {
  entry: BehaviorEntry;
  definition: BehaviorDefinition<unknown>;
  config: unknown;
}

/** Tách việc kiểm tra cấu hình ra khỏi render: entry sai bị bỏ qua và báo lại, trang vẫn chạy. */
export function resolveBehaviors(entries: BehaviorEntry[], registry: BehaviorRegistry) {
  const resolved: ResolvedBehavior[] = [];
  const issues: BehaviorIssue[] = [];
  for (const entry of entries) {
    const definition = Object.hasOwn(registry, entry.identifier)
      ? registry[entry.identifier]
      : undefined;
    if (!definition) {
      issues.push({
        ...pick(entry),
        reason: 'unknown',
        message: `không có behavior "${entry.identifier}"`,
      });
      continue;
    }
    try {
      const config = definition.parse ? definition.parse(entry.configuration) : entry.configuration;
      resolved.push({ entry, definition, config });
    } catch (error) {
      issues.push({ ...pick(entry), reason: 'invalid-config', message: errorMessage(error) });
    }
  }
  return { resolved, issues };
}

const pick = ({ id, identifier }: BehaviorEntry) => ({ id, identifier });
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface BoundaryProps {
  issue: Omit<BehaviorIssue, 'reason' | 'message'>;
  onIssue?: (issue: BehaviorIssue) => void;
  /** nội dung trang bên trong, dùng làm fallback khi chính behavior bị lỗi */
  fallback: ReactNode;
  /** cấu hình đổi thì cho behavior chạy lại (có thể người biên tập đã sửa lỗi) */
  config: unknown;
  children: ReactNode;
}

/** Behavior lỗi lúc render thì bỏ lớp đó đi, vẫn render nội dung trang bên trong. */
class BehaviorBoundary extends Component<BoundaryProps, { failed: boolean; config: unknown }> {
  state = { failed: false, config: this.props.config };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: { failed: boolean; config: unknown },
  ) {
    return props.config === state.config ? null : { failed: false, config: props.config };
  }
  componentDidCatch(error: unknown) {
    this.props.onIssue?.({
      ...this.props.issue,
      reason: 'render-error',
      message: errorMessage(error),
    });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface PageBehaviorsProps {
  behaviors: BehaviorEntry[];
  registry: BehaviorRegistry;
  onIssue?: (issue: BehaviorIssue) => void;
  children: ReactNode;
}

/**
 * Bọc children bằng từng behavior. Behavior ĐẦU danh sách nằm NGOÀI cùng (giống thứ tự middleware).
 * (Bản của Intercom dùng forEach nên ngược lại: behavior đầu danh sách nằm trong cùng.)
 */
export function PageBehaviors({ behaviors, registry, onIssue, children }: PageBehaviorsProps) {
  const { resolved, issues } = useMemo(
    () => resolveBehaviors(behaviors, registry),
    [behaviors, registry],
  );

  useEffect(() => {
    issues.forEach((issue) => onIssue?.(issue));
    // chỉ báo lại khi danh sách behavior đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues]);

  const tree = resolved.reduceRight<ReactNode>((inner, { entry, definition, config }) => {
    const wrapped = createElement(definition.component, { id: entry.id, config, children: inner });
    // key theo id: đổi cấu hình của entry này không làm remount entry khác
    return createElement(BehaviorBoundary, {
      key: entry.id,
      issue: pick(entry),
      onIssue,
      fallback: inner,
      config,
      children: wrapped,
    });
  }, children);

  return createElement(Fragment, null, tree);
}

// ---- CSS từ JSON (cho behavior "custom-styles") ----

export type CssJson = {
  [selectorOrAtRule: string]: CssJson | { [property: string]: string | number };
};

// { } đóng/mở khối, < có thể thành </style>; ; trong giá trị mở thêm khai báo khác
const FORBIDDEN = /[{}<]/;

/**
 * `{ ".hero": { color: "red" }, "@media (max-width: 600px)": { ".hero": { padding: 0 } } }`
 * -> `.hero{color:red;} @media (max-width: 600px){.hero{padding:0;}}`
 * Khác `jsonToCss` của Intercom: chặn ký tự phá cấu trúc ({ } < và ; trong giá trị), và có `scope`
 * để mọi selector chỉ áp dụng bên trong trang (không lỡ tay đổi style của header/footer chung).
 */
export function jsonToCss(json: CssJson | undefined, scope = ''): string {
  if (!json) return '';
  return Object.entries(json)
    .map(([key, body]) => {
      if (FORBIDDEN.test(key)) throw new Error(`selector không hợp lệ: ${key}`);
      if (key.startsWith('@')) return `${key}{${jsonToCss(body as CssJson, scope)}}`;
      const rules = Object.entries(body)
        .map(([property, value]) => {
          if (typeof value === 'object')
            throw new Error(`"${key}" lồng selector: dùng @media hoặc tách ra`);
          const text = String(value);
          if (FORBIDDEN.test(property) || FORBIDDEN.test(text) || text.includes(';')) {
            throw new Error(`giá trị không hợp lệ ở ${key} { ${property} }`);
          }
          return `${property}:${text};`;
        })
        .join('');
      return `${scopeSelector(key, scope)}{${rules}}`;
    })
    .join('\n');
}

function scopeSelector(selector: string, scope: string) {
  if (!scope) return selector;
  return selector
    .split(',')
    .map((part) => (part.trim() === ':scope' ? scope : `${scope} ${part.trim()}`))
    .join(', ');
}
