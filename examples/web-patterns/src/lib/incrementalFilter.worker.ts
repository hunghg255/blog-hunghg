/**
 * Worker cho demo lọc tăng dần: dữ liệu nằm hẳn trong worker, trang chính chỉ gửi điều kiện
 * và nhận về số lượng + vài dòng đầu (không gửi cả danh sách qua lại mỗi lần lọc).
 */
import {
  compilePageRule,
  compileRegexRuleSlow,
  createIncrementalFilter,
  generatePages,
  type Page,
  type Rule,
} from './incrementalFilter';
import { expose } from './workerRpcHost';

let pages: Page[] = [];
const makeFilters = () => ({
  tokens: createIncrementalFilter(pages, compilePageRule),
  regex: createIncrementalFilter(pages, compileRegexRuleSlow),
});
let filters = makeFilters();

expose({
  load({ count, seed }: { count: number; seed: number }) {
    pages = generatePages(count, seed);
    filters = makeFilters();
    return pages.length;
  },
  filter({
    rules,
    incremental,
    limit,
    matcher,
  }: {
    rules: Rule[];
    incremental: boolean;
    limit: number;
    matcher: 'tokens' | 'regex';
  }) {
    const start = performance.now();
    const { result, scanned, reused } = filters[matcher].run(rules, { incremental });
    return {
      count: result.length,
      scanned,
      reused,
      ms: performance.now() - start,
      top: result.slice(0, limit).map((p) => p.url),
    };
  },
});
