/**
 * Xếp hạng gợi ý người nhận ngay trên client + "shadow test" với server.
 *
 * Ý tưởng từ Outlook Web (owa-3s-local):
 * - Danh bạ cache sẵn được dựng thành một prefix trie, gõ tới đâu gợi ý tới đó, không chờ mạng.
 * - Mỗi liên hệ có một vector đặc trưng (feature) lấy từ server; model xếp hạng cũng tải từ server.
 * - Khi kết quả thật của server về, so top-5 của client với server để đo chất lượng ranker
 *   (shadow test), và chép đè feature động của server vào client để tab mở lâu không bị lệch.
 */

export interface Contact {
  /** email, dùng làm khoá như getKeyForSuggestion của Outlook */
  key: string;
  name: string;
}

export type Features = Record<string, number>;

export interface RankerModel {
  version: string;
  /** điểm = Σ weight × feature (Outlook dùng model tải từ server, ở đây là tuyến tính cho dễ đọc) */
  weights: Record<string, number>;
  /**
   * Feature "tĩnh" (Outlook gọi là L2): không chép đè từ server khi so sánh.
   * Các feature còn lại là động: tần suất liên lạc, lần gửi gần nhất…
   */
  staticFeatures: string[];
  /** cặp ký tự hay gõ nhầm (Outlook: Mispellings / setFuzzyCharSwapsData) */
  charSwaps?: [string, string][];
}

export interface Ranked {
  contact: Contact;
  score: number;
  /** khớp nhờ sửa lỗi gõ */
  fuzzy?: boolean;
}

/** Bỏ dấu tiếng Việt + chữ thường: "Đức" → "duc". */
export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Prefix trie
// ---------------------------------------------------------------------------

interface TrieNode {
  children: Map<string, TrieNode>;
  /** mọi khoá có một từ bắt đầu bằng tiền tố này (lưu ở mọi nút: tra cứu O(độ dài query)) */
  keys: Set<string>;
}

const newNode = (): TrieNode => ({ children: new Map(), keys: new Set() });

export class PrefixTrie {
  private root = newNode();
  private nodes = 1;

  /** Thêm `key` dưới mọi "từ" của nó: phần trước @ của email, từng phần của tên, cả tên liền. */
  add(contact: Contact) {
    const local = contact.key.split('@')[0];
    const parts = normalize(contact.name).split(/\s+/).filter(Boolean);
    const words = new Set([normalize(local), ...parts, parts.join('')]);
    for (const word of words) {
      let node = this.root;
      node.keys.add(contact.key);
      for (const ch of word) {
        let next = node.children.get(ch);
        if (!next) {
          next = newNode();
          node.children.set(ch, next);
          this.nodes++;
        }
        next.keys.add(contact.key);
        node = next;
      }
    }
  }

  find(prefix: string): Set<string> {
    let node: TrieNode | undefined = this.root;
    for (const ch of normalize(prefix)) {
      node = node.children.get(ch);
      if (!node) return new Set();
    }
    return node.keys;
  }

  get size() {
    return this.nodes;
  }
}

/** Các biến thể của query sau khi đổi MỘT cặp ký tự hay gõ nhầm, hoặc đảo hai ký tự liền nhau. */
export function fuzzyVariants(query: string, charSwaps: [string, string][] = []) {
  const q = normalize(query);
  const out = new Set<string>();
  for (let i = 0; i < q.length - 1; i++) {
    out.add(q.slice(0, i) + q[i + 1] + q[i] + q.slice(i + 2)); // "nugyen" → "nguyen"
  }
  for (const [a, b] of charSwaps) {
    for (let i = q.indexOf(a); i !== -1; i = q.indexOf(a, i + 1)) {
      out.add(q.slice(0, i) + b + q.slice(i + a.length));
    }
  }
  out.delete(q);
  return [...out];
}

// ---------------------------------------------------------------------------
// Ranker
// ---------------------------------------------------------------------------

export interface ShadowReport {
  /** 1 nếu client và server trùng nhau ở vị trí đó (top-5) */
  matchedPositions: number[];
  orderMismatches: number;
  /** server gợi ý nhưng client không có trong kết quả */
  missingFromClient: string[];
  /** client gợi ý nhưng server không trả về */
  missingFromServer: string[];
  featureDiffs: { key: string; feature: string; client: number; server: number }[];
  /** số giá trị feature đã chép đè từ server */
  synced: number;
}

export function createLocalRanker(model: RankerModel) {
  const contacts = new Map<string, Contact>();
  const featureStores = new Map<string, Features>();
  const trie = new PrefixTrie();

  const score = (key: string) => {
    const features = featureStores.get(key);
    if (!features) return 0; // bản Outlook không kiểm tra, store thiếu là TypeError
    let total = 0;
    for (const [name, weight] of Object.entries(model.weights)) total += weight * (features[name] ?? 0);
    return total;
  };

  return {
    model,
    /** Nạp danh bạ cache + feature từ server (Outlook: createFeatureStore + constructSuggestionTrie). */
    load(entries: { contact: Contact; features: Features }[]) {
      for (const { contact, features } of entries) {
        contacts.set(contact.key, contact);
        // Outlook không ghi đè feature của liên hệ đã có: giữ giá trị lúc nạp
        if (!featureStores.has(contact.key)) featureStores.set(contact.key, { ...features });
        trie.add(contact);
      }
    },

    search(query: string, limit = 5): Ranked[] {
      if (!query.trim()) return [];
      let keys = [...trie.find(query)];
      let fuzzy = false;
      if (keys.length === 0) {
        // Không có gì khớp đúng: thử các biến thể gõ nhầm
        const found = new Set<string>();
        for (const variant of fuzzyVariants(query, model.charSwaps)) trie.find(variant).forEach((k) => found.add(k));
        keys = [...found];
        fuzzy = keys.length > 0;
      }
      return keys
        .map((key) => ({ contact: contacts.get(key)!, score: score(key), fuzzy }))
        .sort((a, b) => b.score - a.score || a.contact.name.localeCompare(b.contact.name))
        .slice(0, limit);
    },

    /**
     * Shadow test: so kết quả client với server, rồi (tuỳ chọn) chép đè feature động của server.
     * `server` là danh sách server trả về theo thứ tự, kèm feature mới nhất của từng liên hệ.
     */
    compareWithServer(
      clientResults: Ranked[],
      server: { key: string; features: Features }[],
      { sync = true, positions = 5 } = {},
    ): ShadowReport {
      const clientKeys = clientResults.map((r) => r.contact.key);
      const serverKeys = server.map((s) => s.key);
      const matchedPositions = Array.from({ length: positions }, (_, i) =>
        clientKeys[i] !== undefined && clientKeys[i] === serverKeys[i] ? 1 : 0,
      );
      // Outlook dừng đếm ở vị trí đầu tiên một bên hết kết quả; ở đây đếm hết `positions`
      const orderMismatches = matchedPositions.filter(
        (m, i) => m === 0 && (clientKeys[i] !== undefined || serverKeys[i] !== undefined),
      ).length;

      const featureDiffs: ShadowReport['featureDiffs'] = [];
      let synced = 0;
      for (const { key, features } of server) {
        const local = featureStores.get(key);
        if (!local) continue;
        for (const name of new Set([...Object.keys(local), ...Object.keys(features)])) {
          const client = local[name] ?? 0;
          const fresh = features[name] ?? 0;
          if (client === fresh) continue;
          if (clientKeys.includes(key)) featureDiffs.push({ key, feature: name, client, server: fresh });
          if (sync && !model.staticFeatures.includes(name)) {
            local[name] = fresh;
            synced++;
          }
        }
      }

      return {
        matchedPositions,
        orderMismatches,
        missingFromClient: serverKeys.filter((k) => !clientKeys.includes(k)),
        missingFromServer: clientKeys.filter((k) => !serverKeys.includes(k)),
        featureDiffs,
        synced,
      };
    },

    features(key: string) {
      return featureStores.get(key);
    },

    stats() {
      return { contacts: contacts.size, trieNodes: trie.size };
    },
  };
}

export type LocalRanker = ReturnType<typeof createLocalRanker>;
