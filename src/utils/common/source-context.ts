/**
 * 定位输入：仅依赖 source 与可选的偏移/行号。
 * 用本地结构而非引用 views 层的 AstItem，解除 utils → views 的反向类型依赖。
 */
export interface SourceLocateInput {
    source: string;
    start?: number;
    end?: number;
    line?: number;
}

// 上下文窗口大小（字符数），对压缩成单行的 minified 代码同样可读
const CONTEXT_WINDOW = 120;

// 以记录行号为中心向两侧扩展的行数：偏移整体漂移时仍能命中正确位置
const LINE_ANCHOR_SPAN = 2;

// 节点形态校验时取 source 的前 N 个字符作为比对探针
const OFFSET_NEIGHBORHOOD = 8;

/** 回退搜索的命中结果，附带歧义信息供 UI 提示 */
interface SearchHit {
    start: number;
    end: number;
    /** source 在全文中的出现次数（> 1 即存在同名歧义） */
    occurrences: number;
    /** 当前命中是第几处（1-based） */
    ordinal: number;
}

export interface SourceContext {
    before: string;
    match: string;
    after: string;
    line: number | null;
    start: number;
    end: number;
    /** 位置来自条目记录的偏移（精确或邻域命中）时为 true；回退搜索得到时为 false */
    fromCache: boolean;
    /** 源码总行数：单行 minified 代码下行号无参考意义，UI 应改显示偏移 */
    lineCount: number;
    /** 回退定位时的歧义信息；偏移命中时缺省 */
    occurrences?: number;
    ordinal?: number;
}

/**
 * 定位索引缓存：同一份 code 复用一份索引，避免批量判定 / 弹窗重渲染时
 * 反复全文扫描与行号重算（对 5-10MB 的 minified main.js 尤为关键）。
 *
 * 由调用方显式创建并持有（按 code 维度），**不再使用模块级全局单例**：
 * 全局单例在「多文件切换 / 源码变更」场景下易出现索引串味或残留过期数据，
 * 显式缓存把生命周期交给调用方，code 变更时新建缓存即可，无需额外的 invalidate()。
 */
export interface SourceContextCache {
    code: string;
    /** 换行符偏移，升序（供二分求行号） */
    newlines: Int32Array;
    /** `${line ?? ''}|${source}` → 回退查找命中结果（null 表示未命中） */
    positions: Map<string, SearchHit | null>;
}

/** 为给定 code 构建一份定位索引缓存（code 变更时由调用方重新创建即可） */
export function createSourceContextCache(code: string): SourceContextCache {
    const newlines: number[] = [];
    for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === 10) newlines.push(i);
    }
    return { code, newlines: Int32Array.from(newlines), positions: new Map() };
}

/** 二分求 offset 前换行符数量，返回 1-based 行号 */
function lineAt(newlines: Int32Array, offset: number): number {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (newlines[mid] < offset) lo = mid + 1;
        else hi = mid;
    }
    return lo + 1;
}

/** 是否为标识符字符（字母/数字/下划线/$），用于判断匹配是否嵌在标识符内部 */
function isIdentChar(ch: string): boolean {
    return ch !== '' && /[A-Za-z0-9_$]/.test(ch);
}

/** 取 1-based 行号的行首偏移 */
function lineStart(newlines: Int32Array, line: number): number {
    return line > 1 ? newlines[line - 2] + 1 : 0;
}

/** 取 1-based 行号的行尾偏移（不含换行符） */
function lineEnd(newlines: Int32Array, line: number, codeLength: number): number {
    return line <= newlines.length ? newlines[line - 1] : codeLength;
}

/**
 * 边界感知地在 [from, to) 内查找 source 的偏移：
 * 跳过「嵌在标识符内部的子串」匹配（如 _reactRetry 中的 Retry、setShouldRemove 中的 REMOVE），
 * 只接受两侧都不紧贴标识符字符的命中（真实字符串字面量两侧必为引号/分隔符）。
 * 若全程无边界匹配，回退到区间内的首个原始匹配以保证尽量定位到某个位置。
 */
function findBoundaryMatch(code: string, source: string, from = 0, to = code.length): number {
    const first = code.indexOf(source, from);
    if (first < 0 || first + source.length > to) return -1;
    let idx = first;
    while (idx >= 0 && idx + source.length <= to) {
        const before = idx > 0 ? code[idx - 1] : '';
        const after = idx + source.length < code.length ? code[idx + source.length] : '';
        // 任一侧紧贴标识符字符 ⇒ 命中位于某标识符内部，跳过继续找
        if (!isIdentChar(before) && !isIdentChar(after)) return idx;
        idx = code.indexOf(source, idx + source.length);
    }
    return first; // 兜底：无边界命中时仍返回区间内首个原始匹配
}

/**
 * 校验并记录条目的字符偏移。
 *
 * 注意：extract() 记录的是 Babel **节点**范围，StringLiteral / TemplateLiteral 的
 * node.start 指向包裹符（引号或反引号），而 source 是不含包裹符的文本，
 * 两者天然差一层，直接严格相等永远不成立。因此先按原样比较，
 * 再剥离成对包裹符比较一次，命中时把区间内缩到内容区（用于开窗与高亮）。
 */
function resolveByOffset(code: string, item: SourceLocateInput): { start: number; end: number } | null {
    const { start, end, source } = item;
    if (start == null || end == null) return null;
    if (!(start >= 0 && end > start && end <= code.length)) return null;

    const raw = code.slice(start, end);
    if (raw === source) return { start, end };

    const quote = raw[0];
    if ((quote === '"' || quote === "'" || quote === '`') && raw[raw.length - 1] === quote) {
        if (raw.slice(1, -1) === source) return { start: start + 1, end: end - 1 };
    }
    return null;
}

/** raw 是否被成对的引号/反引号包裹（字符串字面量的形态特征） */
function isWrappedLiteral(raw: string): boolean {
    if (raw.length < 2) return false;
    const q = raw[0];
    return (q === '"' || q === "'" || q === '`') && raw[raw.length - 1] === q;
}

/**
 * 节点范围内定位：偏移本身可信、只是无法与 source 做字符串比较时使用。
 *
 * 典型场景是含转义序列的字面量：源码里是 `"a\nb"`（raw 6 字符），
 * 而 source 是 cooked 值 `a<LF>b`（3 字符），源码中根本不存在该字面文本，
 * 无论全文还是邻域搜索都找不到——此时应直接采信节点范围并原样展示。
 *
 * 可信性由两条证据把关，避免单行 minified 代码下偏移跑飞却被盲信：
 *   1. 强证据：记录的行号与偏移推算出的行号一致（多行源码下极可靠）
 *   2. 弱证据：节点范围具备字面量形态，或包含 source 的片段
 */
function resolveWithinNode(
    code: string,
    item: SourceLocateInput,
    newlines: Int32Array
): { start: number; end: number } | null {
    const { start, end, source, line } = item;
    if (start == null || end == null) return null;
    if (!(start >= 0 && end > start && end <= code.length)) return null;

    // 无行号（单行 minified 或旧数据）时跳过行号校验，仅靠形态证据
    if (line && line > 0 && lineAt(newlines, start) !== line) return null;

    const raw = code.slice(start, end);
    const probe = source.slice(0, Math.min(OFFSET_NEIGHBORHOOD, source.length));
    if (!isWrappedLiteral(raw) && !raw.includes(probe)) return null;

    const idx = findBoundaryMatch(code, source, start, end);
    return idx >= 0 ? { start: idx, end: idx + source.length } : { start, end };
}

/**
 * 失效偏移的回退定位：优先在记录行号附近搜索，最后才全文查找。
 *
 * 直接全文取首次命中会把 "Apply" 这类常见短词定位到源码中更早出现的
 * "Apply custom command"，与条目记录的行号（L4578）完全对不上。
 * 行号比偏移稳定（局部增删不会让整行文本漂移），故优先按行锚点搜索。
 *
 * 局限：minified 代码整份只有几行（甚至 1 行）时，行锚点区间会退化成全文，
 * 此时若源码里存在多处同名文本，只能取到首次命中——故结果附带歧义信息，
 * 由 UI 明确提示「共 N 处，当前第 K 处」，而不是静默展示一个可能错误的位置。
 */
function locateBySearch(cache: SourceContextCache, item: SourceLocateInput): SearchHit | null {
    const { code, newlines, positions } = cache;
    // 缓存键带上行号：同源文本在不同行是不同命中，避免串味
    const key = `${item.line ?? ''}|${item.source}`;
    const cached = positions.get(key);
    const hit = cached !== undefined ? cached : searchWithLineAnchor(code, newlines, item);
    if (cached === undefined) positions.set(key, hit);
    return hit;
}

function searchWithLineAnchor(code: string, newlines: Int32Array, item: SourceLocateInput): SearchHit | null {
    let idx = -1;
    if (item.line && item.line > 0) {
        const from = lineStart(newlines, Math.max(1, item.line - LINE_ANCHOR_SPAN));
        const to = lineEnd(newlines, item.line + LINE_ANCHOR_SPAN, code.length);
        if (to > from) idx = findBoundaryMatch(code, item.source, from, to);
    }
    if (idx < 0) idx = findBoundaryMatch(code, item.source);
    if (idx < 0) return null;
    return {
        start: idx,
        end: idx + item.source.length,
        occurrences: countOccurrences(code, item.source),
        ordinal: ordinalAt(code, item.source, idx),
    };
}

/** source 在全文中的出现总次数（含嵌在标识符内的，用于衡量歧义程度） */
function countOccurrences(code: string, source: string): number {
    let count = 0;
    let idx = code.indexOf(source);
    while (idx >= 0) {
        count++;
        idx = code.indexOf(source, idx + source.length);
    }
    return count;
}

/** idx 处命中是全文第几处（1-based） */
function ordinalAt(code: string, source: string, idx: number): number {
    let n = 0;
    let i = code.indexOf(source);
    while (i >= 0 && i <= idx) {
        n++;
        i = code.indexOf(source, i + source.length);
    }
    return n;
}

/**
 * 按字符偏移开窗截取源码上下文并高亮目标串。
 * 对压缩代码（行号恒为 1）依然有效：优先用 Babel 节点的 start/end 偏移，
 * 偏移失效时回退到「行号锚点优先」的搜索定位。
 *
 * @param cache 由 createSourceContextCache 创建的缓存
 */
export function getSourceContext(
    cache: SourceContextCache,
    item: SourceLocateInput
): SourceContext | null {
    const code = cache.code;
    if (!code) return null;

    let start: number;
    let end: number;
    let occurrences: number | undefined;
    let ordinal: number | undefined;

    // 1. 精确偏移：提取时刻的节点范围最可靠（校验时容忍包裹符差异）
    // 2. 节点范围内定位：含转义等无法直接比较时，行号+形态校验后采信节点范围
    //    以上两步命中位置必是条目原指向的节点，不存在同名文本歧义
    const byOffset = resolveByOffset(code, item) ?? resolveWithinNode(code, item, cache.newlines);
    if (byOffset) {
        start = byOffset.start;
        end = byOffset.end;
    } else {
        // 3. 偏移彻底失效（旧数据缺省 / 插件更新导致源码漂移）⇒ 行号锚点优先的回退搜索，
        //    该路径可能命中同名文本的其它出现处，故带出歧义信息交给 UI 提示
        const hit = locateBySearch(cache, item);
        if (!hit) return null;
        start = hit.start;
        end = hit.end;
        occurrences = hit.occurrences;
        ordinal = hit.ordinal;
    }

    const from = Math.max(0, start - CONTEXT_WINDOW);
    const to = Math.min(code.length, end + CONTEXT_WINDOW);
    const before = code.slice(from, start);
    const match = code.slice(start, end);
    const after = code.slice(end, to);
    // 行号一律由实际命中位置推算，保证与展示片段同源（偏移命中时与 item.line 天然一致）
    const line = lineAt(cache.newlines, start);
    return {
        before, match, after, line, start, end,
        fromCache: !!byOffset,
        lineCount: cache.newlines.length + 1,
        occurrences, ordinal,
    };
}

/**
 * 构造供 AI 判定使用的精简源码上下文片段。
 *
 * 与 UI 预览不同：判定请求一次可能携带数百条，片段需严格限长以控制 token 开销。
 * 目标串 (match) 始终优先完整保留，前后文按剩余预算分配——前文取尾部、
 * 后文取头部，从而在有限预算内最大化紧贴目标串的信息量。
 *
 * @param cache  源码全文缓存，为空时返回 undefined（判定侧按缺省处理）并打 debug 日志
 * @param item   定位输入
 * @param maxLen 片段总长上限 (字符)
 */
export function buildJudgeSnippet(
    cache: SourceContextCache,
    item: SourceLocateInput,
    maxLen = 160
): string | undefined {
    if (!cache.code) {
        // 无源码时退化为不带上下文，但记录一条 debug 便于排查「判定为何没有上下文」
        console.debug('[source-context] buildJudgeSnippet: 源码为空，判定将不带上下文');
        return undefined;
    }

    const ctx = getSourceContext(cache, item);
    if (!ctx) return undefined;

    const { before, match, after } = ctx;

    // 目标串本身就超预算：截断并加省略号标记，避免模型误以为串原本就这么短
    if (match.length >= maxLen) return match.slice(0, maxLen - 1) + '…';

    const rest = maxLen - match.length;
    const half = Math.floor(rest / 2);
    // 前文取尾部 (紧贴目标串)，后文取头部；前文不足时把余额让给后文
    const beforePart = before.length > half ? before.slice(-half) : before;
    const afterPart = after.slice(0, rest - beforePart.length);

    return beforePart + match + afterPart;
}
