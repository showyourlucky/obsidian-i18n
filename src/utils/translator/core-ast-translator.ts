import fs from 'fs';
import { parse, parseExpression } from "@babel/parser";
import traverse from '@babel/traverse';
import { generate } from "@babel/generator";
import * as t from '@babel/types';
import { PluginTranslationV1Ast, PluginTranslationV1Regex } from '~/types';
import { I18nSettings } from '../../settings/data';

// ====================================================================================================
//                                      Configuration (白名单配置)
// ====================================================================================================

/**
 * 严格白名单配置
 * 只有在以下上下文中出现的字符串才会被考虑提取
 */
import {
    AST_DEFAULT_CONFIG, AST_DEFAULT_RULES,
    HARDCODED_WORDS, LOGIC_BINARY_OPERATORS, LOGIC_STRING_METHODS, EVENT_LISTENER_METHODS, DOM_EVENT_NAMES,
    DOM_CREATE_SHORTHAND_ARGS, STRUCTURAL_KEYS, DOM_CREATE_STRUCTURAL_KEYS, FRAMEWORK_CREATE_FUNCS
} from './config';

/**
 * 逻辑字符串的判定原因 (用于逻辑审计的结果展示)
 */
export type LogicReason =
    | 'method'      // 参与字符串方法调用: startsWith / includes / replace ...
    | 'binary'      // 参与二元比较: === / in / instanceof ...
    | 'switch'      // switch case 分支值
    | 'objectKey'   // 对象键名
    | 'hardcoded'   // 硬编码依赖词: module / default ...
    | 'eventName'   // DOM 事件名: click / mousemove ...
    | 'event';      // 事件注册方法的首参: addEventListener('mousemove')

/** 判定命中逻辑字符串时的详情 */
export interface LogicStringInfo {
    reason: LogicReason;
    /** 触发判定的上下文 (方法名 / 运算符 / 事件名 / 键名) */
    context: string;
}

/** 源码中单个字符串字面量的上下文信息 (逻辑审计的扫描产物) */
export interface StringContextInfo {
    type: string;
    name: string;
    source: string;
    fingerprint: string;
    /** 源码偏移，用于 Regex 条目的位置映射 (-1 表示无位置信息) */
    start: number;
    end: number;
    line: number;
    /** 处于 DOM 结构位置 (类名 / 标签名)，translate() 会主动跳过 */
    structural: boolean;
    /** 参与程序逻辑：翻译后不会崩溃，但判断/分支/事件监听会静默失效 */
    logic: boolean;
    reason: LogicReason | null;
    context: string;
}

/** 逻辑审计命中项 */
export interface LogicStringHit {
    kind: 'ast' | 'regex';
    id: number;
    source: string;
    target: string;
    reason: LogicReason;
    context: string;
    line: number;
}

export class AstTranslator {
    private settings: I18nSettings;
    private config: any;
    private contentRules: any;

    constructor(settings: I18nSettings) {
        this.settings = settings;
        this.initPatterns();
    }

    private initPatterns() {
        this.config = {
            assignments: this.settings?.astAssignments || AST_DEFAULT_CONFIG.assignments,
            functions: this.settings?.astFunctions || AST_DEFAULT_CONFIG.functions,
            keys: this.settings?.astKeys || AST_DEFAULT_CONFIG.keys,
        };

        const userReject = (this.settings?.astRejectRe || []).map((re: string) => {
            try { return new RegExp(re); } catch { return null; }
        }).filter(Boolean) as RegExp[];

        this.contentRules = {
            // 系统内置基础安全正则永远生效，同时追加用户的自定义排除正则
            REJECT_PATTERNS: [...AST_DEFAULT_RULES.REJECT_PATTERNS, ...userReject],
            VALID_PATTERNS: (this.settings?.astValidRe || []).length > 0
                ? this.settings!.astValidRe.map((re: string) => {
                    try { return new RegExp(re); } catch { return null; }
                }).filter(Boolean) as RegExp[]
                : AST_DEFAULT_RULES.VALID_PATTERNS,
        };
    }

    // ====================================================================================================
    //                                      1. Public API
    // ====================================================================================================

    public loadFile(filePath: string, isModule: boolean = false) {
        try {
            return this.parseAst(fs.readFileSync(filePath, 'utf8'), isModule);
        } catch (e) {
            console.error(`Error loading file ${filePath}:`, e);
            return null;
        }
    }

    public loadCode(code: string, isModule: boolean = false) {
        return this.parseAst(code, isModule);
    }

    /**
     * 提取逻辑 (极度保守)
     * 1. 只从 settings 白名单上下文中提取
     * 2. 只提取通过 isValidText 校验的内容
     */
    public extract(ast: t.Node): PluginTranslationV1Ast[] {
        const results: PluginTranslationV1Ast[] = [];

        this.traverseWhitelist(ast, (type, name, valueNode, extra) => {
            const source = this.extractSource(valueNode);
            // 双重校验：上下文白名单 (implicit) + 内容有效性 (explicit)
            if (source && this.isValidText(source)) {
                results.push({
                    type, name, source, target: source,
                    start: valueNode.start ?? undefined,
                    end: valueNode.end ?? undefined,
                    line: valueNode.loc?.start.line ?? undefined,
                    col: valueNode.loc?.start.column ?? undefined,
                    propKey: extra?.propKey,
                    argIndex: extra?.argIndex,
                });
            }
        });

        return this.deduplicateResults(results);
    }

    /**
     * 解析宽松匹配 (fallback) 的启用状态
     * 严格模式开启时完全禁用宽松回退，只认 type:name:source 指纹
     */
    private isLooseMatchEnabled(options?: { strict?: boolean }): boolean {
        if (typeof options?.strict === 'boolean') return !options.strict;
        return !this.settings?.astStrictMatch;
    }

    /**
     * 翻译逻辑 (宽松匹配 + 上下文安全校验)
     * 支持严格匹配 (type:name:source) 和宽松匹配 (source only)
     *
     * BUG-001: 宽松匹配会丢弃 AST 上下文，把全代码所有同文本字面量一并替换。
     * 因此回退必须满足两个前提:
     *   1. 未开启严格模式
     *   2. 该字符串字面量不参与程序逻辑 (比较 / 分支 / 对象键 / 硬编码依赖词)
     */
    public translate(ast: t.Node, translations: PluginTranslationV1Ast[], options: { strict?: boolean } = {}): string {
        // 1. 构建查找表
        const strictMap = new Map<string, string>(); // type:name:source -> target
        const looseMap = new Map<string, string>();  // source -> target (fallback)
        const allowLoose = this.isLooseMatchEnabled(options);

        translations.forEach(item => {
            if (item.type && item.name) {
                strictMap.set(this.getFingerprint(item), item.target);
            }
            looseMap.set(item.source, item.target);
        });

        // 2. 遍历所有字符串节点 (不限于白名单，以支持手动添加的条目)
        this.traverseAllStrings(ast, (type, name, valueNode, safe, structural) => {
            const source = this.extractSource(valueNode);
            // 类名 / 标签名 / 标识符：命中也不替换 (历史翻译包里可能残留这类条目)
            if (!source || structural) return;

            // 尝试匹配
            let target = strictMap.get(this.getFingerprint({ type, name, source } as any));
            // 严格匹配失败时，仅当该字符串不参与程序逻辑才允许回退
            if (!target && allowLoose && safe && this.isWhitelistedContext(type, name)) {
                target = looseMap.get(source);
            }

            if (target && target !== source) {
                this.replaceSource(valueNode, target);
            }
        });

        // 3. 生成代码
        return generate(ast, {
            minified: true,
            comments: false,
            jsescOption: { minimal: true }
        }).code;
    }

    /**
     * 跟踪翻译项的使用情况
     * 模拟翻译过程，记录哪些翻译项在源码中找到了匹配点
     * 口径必须与 translate() 完全一致，否则冗余诊断会误报
     */
    public traceUsage(ast: t.Node, translations: PluginTranslationV1Ast[], options: { strict?: boolean } = {}): Set<string> {
        const hitFingerprints = new Set<string>();

        // 1. 构建查找表
        const strictMap = new Map<string, string>(); // fingerprint -> target
        const looseMap = new Map<string, string>();  // source -> target
        const allowLoose = this.isLooseMatchEnabled(options);

        translations.forEach(item => {
            if (item.type && item.name) {
                strictMap.set(this.getFingerprint(item), item.target);
            }
            looseMap.set(item.source, item.target);
        });

        // 2. 遍历所有匹配项 (口径与 translate() 保持一致)
        this.traverseAllStrings(ast, (type, name, valueNode, safe, structural) => {
            const source = this.extractSource(valueNode);
            if (!source || structural) return;

            const fingerprint = this.getFingerprint({ type, name, source } as any);
            if (strictMap.has(fingerprint)) {
                hitFingerprints.add(fingerprint);
            } else if (allowLoose && safe && this.isWhitelistedContext(type, name) && looseMap.has(source)) {
                // 如果严格匹配失败但宽松匹配成功，记录下宽松匹配的标示
                hitFingerprints.add(source);
            }
        });

        return hitFingerprints;
    }

    /**
     * 逻辑审计 (静态扫描，不重载插件)
     *
     * 语法诊断依赖「沙箱重启」，只能抓出会让插件直接崩溃的条目；
     * 而逻辑字符串 (事件名 / 比较值 / 分支值 / 对象键) 被翻译后插件照常运行，
     * 只是对应功能静默失效，崩溃类诊断完全查不到。
     *
     * 本方法对源码做一次完整扫描，结合 translate() 的实际替换口径，
     * 列出所有「已翻译且命中逻辑字符串」的条目，供用户一键还原:
     *   - AST 条目：严格指纹命中 (translate() 中严格匹配不校验 safe，正是风险来源)
     *   - Regex 条目：纯文本替换，按源码位置映射回字符串字面量后判定
     *
     * @param ast 原始源码 AST
     * @param astItems AST 翻译条目
     * @param regexItems Regex 翻译条目
     * @param code 原始源码全文 (Regex 条目定位用，缺省时跳过 Regex 审计)
     */
    public auditLogicStrings(
        ast: t.Node,
        astItems: (PluginTranslationV1Ast & { id?: number })[] = [],
        regexItems: (PluginTranslationV1Regex & { id?: number })[] = [],
        code: string = ''
    ): LogicStringHit[] {
        const hits: LogicStringHit[] = [];
        const seen = new Set<string>();

        // 1. 严格指纹查找表 (只关心已翻译的条目)
        const strictMap = new Map<string, PluginTranslationV1Ast & { id?: number }>();
        for (const item of astItems) {
            if (!item.type || !item.name) continue;
            if (!item.source || !item.target || item.source === item.target) continue;
            strictMap.set(this.getFingerprint(item), item);
        }

        // 2. 扫描源码中所有字符串字面量的上下文 (按起始位置升序，供 Regex 条目二分定位)
        const contexts: StringContextInfo[] = [];
        this.traverseAllLiterals(ast, ctx => contexts.push(ctx));
        contexts.sort((a, b) => a.start - b.start);

        const push = (kind: 'ast' | 'regex', item: { id?: number, source: string, target: string }, ctx: StringContextInfo) => {
            const id = item.id ?? -1;
            const key = `${kind}:${id}`;
            if (seen.has(key)) return;
            seen.add(key);
            hits.push({
                kind,
                id,
                source: item.source,
                target: item.target,
                reason: ctx.reason as LogicReason,
                context: ctx.context,
                line: ctx.line
            });
        };

        // 3. AST 条目：严格指纹命中逻辑上下文 → 翻译后功能静默失效
        for (const ctx of contexts) {
            if (!ctx.logic || !ctx.reason) continue;
            const item = strictMap.get(ctx.fingerprint);
            if (item) push('ast', item, ctx);
        }

        // 4. Regex 条目：纯文本替换，任一命中点落在逻辑字符串上即视为风险
        if (code) {
            for (const item of regexItems) {
                if (!item.source || !item.target || item.source === item.target) continue;
                for (const [start, end] of this.locateLiteralRanges(code, item.source)) {
                    let hit: StringContextInfo | null = null;
                    for (const ctx of this.contextsInRange(contexts, start, end)) {
                        if (ctx.logic && ctx.reason) { hit = ctx; break; }
                    }
                    if (hit) push('regex', item, hit);
                }
            }
        }

        return hits;
    }

    /**
     * 全字面量遍历器 (仅用于审计，不影响翻译口径)
     *
     * traverseAllStrings 只覆盖 5 类可翻译位置，而 Regex 翻译器是纯文本替换，
     * 会命中二元比较、switch case 等它根本不遍历的字面量。
     * 审计必须看到全部字面量，否则会漏报 Regex 条目的风险。
     */
    private traverseAllLiterals(ast: t.Node, callback: (info: StringContextInfo) => void) {
        const visit = (path: any) => {
            const valueNode = path.node as t.StringLiteral | t.TemplateLiteral;
            const source = this.extractSource(valueNode);
            if (!source) return;

            const logic = this.logicStringReason(path);
            const structural = this.isStructuralContext(path);
            const { type, name } = this.describeLiteralContext(path);

            callback({
                type,
                name,
                source,
                // 无有效上下文 (如二元比较中的字面量) 不参与 AST 条目的指纹匹配
                fingerprint: type && name ? this.getFingerprint({ type, name, source } as any) : '',
                start: valueNode.start ?? -1,
                end: valueNode.end ?? -1,
                line: valueNode.loc?.start.line ?? 0,
                structural,
                logic: logic !== null && !structural,
                reason: logic?.reason ?? null,
                context: logic?.context ?? ''
            });
        };

        traverse(ast, {
            StringLiteral: visit,
            TemplateLiteral: visit
        });
    }

    /** 推断字符串字面量所处的上下文类型与名称 (口径与 traverseAllStrings 保持一致) */
    private describeLiteralContext(path: any): { type: string, name: string } {
        const node = path.node;
        const parent = path.parentPath?.node;
        if (!parent) return { type: '', name: '' };

        if (t.isVariableDeclarator(parent) && parent.init === node) {
            return { type: 'VariableDeclarator', name: t.isIdentifier(parent.id) ? parent.id.name : 'var' };
        }
        if (t.isAssignmentExpression(parent) && parent.right === node) {
            return { type: 'AssignmentExpression', name: this.getAssignName(parent.left) || 'assign' };
        }
        if (t.isObjectProperty(parent) && parent.value === node) {
            return { type: 'ObjectProperty', name: this.getObjKeyName(parent.key) || 'prop' };
        }
        if (t.isCallExpression(parent) && Array.isArray(parent.arguments) && (parent.arguments as any[]).includes(node)) {
            return { type: 'CallExpression', name: this.getCallName(parent.callee) || 'func' };
        }
        if (t.isNewExpression(parent) && Array.isArray(parent.arguments) && (parent.arguments as any[]).includes(node)) {
            return { type: 'NewExpression', name: this.getCallName(parent.callee) || 'new' };
        }
        return { type: '', name: '' };
    }

    /** 二分定位与 [start, end) 区间相交的字符串字面量上下文 */
    private contextsInRange(contexts: StringContextInfo[], start: number, end: number): StringContextInfo[] {
        const result: StringContextInfo[] = [];
        if (start < 0 || end <= start) return result;

        // 找到第一个 end > start 的位置
        let lo = 0, hi = contexts.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (contexts[mid].end <= start) lo = mid + 1;
            else hi = mid;
        }

        for (let i = lo; i < contexts.length; i++) {
            if (contexts[i].start >= end) break;
            result.push(contexts[i]);
        }
        return result;
    }

    /**
     * 定位 Regex 条目 source 在源码中的替换区间
     * 口径与 RegexTranslator.replaceLiteral 保持一致:
     *   - source 自带引号 (如 "Cancel" / Notice("Cancel"))：整体替换
     *   - source 为裸文本 (如 default)：仅替换被引号完整包裹的片段
     */
    private locateLiteralRanges(code: string, source: string): [number, number][] {
        const ranges: [number, number][] = [];
        if (!source) return ranges;

        const wrapped = /["'`]/.test(source);
        let from = 0;
        while (true) {
            const idx = code.indexOf(source, from);
            if (idx === -1) break;
            from = idx + 1;

            if (wrapped) {
                ranges.push([idx, idx + source.length]);
                continue;
            }

            // 裸文本：两侧必须是同种引号，区间向外扩一格以覆盖引号
            const before = idx > 0 ? code[idx - 1] : '';
            const after = code[idx + source.length] || '';
            if (before && before === after && (before === '"' || before === "'" || before === '`')) {
                ranges.push([idx - 1, idx + source.length + 1]);
            }
        }
        return ranges;
    }

    /**
     * 验证目标内容的安全性 (精准版)
     * @param target 目标翻译字符串
     * @returns { severity: string, message: string }[]
     */
    public validateSecurity(target: string): { severity: 'critical' | 'warning', message: string }[] {
        const issues: { severity: 'critical' | 'warning', message: string }[] = [];
        if (!target) return issues;

        // 1. 致命威胁检测 (注入 & 执行)
        // 使用 \b 确保是完整的单词，避免误报 "Fetch data"
        const criticalPatterns = [
            { regex: /\beval\s*\(/i, name: 'eval()' },
            { regex: /\bFunction\s*\(/i, name: 'new Function()' },
            { regex: /\bsetTimeout\s*\(\s*['"`]/i, name: 'setTimeout(string)' },
            { regex: /\bsetInterval\s*\(\s*['"`]/i, name: 'setInterval(string)' },
            { regex: /<script/i, name: '<script>' },
            { regex: /\bjavascript:/i, name: 'javascript:' },
        ];

        for (const pattern of criticalPatterns) {
            if (pattern.regex.test(target)) {
                issues.push({
                    severity: 'critical',
                    message: `发现危险的执行指令: ${pattern.name}`
                });
            }
        }

        // 2. 可疑行为检测 (网络 & 敏感环境)
        const warningPatterns = [
            { regex: /\bfetch\s*\(/i, name: 'fetch()' },
            { regex: /\bXMLHttpRequest\b/i, name: 'XMLHttpRequest' },
            { regex: /\bWebSocket\b/i, name: 'WebSocket' },
            { regex: /\brequire\s*\(/i, name: 'require()' },
            { regex: /\bprocess\./i, name: 'Node.js process' },
            { regex: /\belectron\./i, name: 'Electron API' },
            { regex: /\blocalStorage\b/i, name: 'localStorage' },
            { regex: /\bdocument\.cookie\b/i, name: 'document.cookie' },
        ];

        for (const pattern of warningPatterns) {
            if (pattern.regex.test(target)) {
                issues.push({
                    severity: 'warning',
                    message: `发现可疑的代码模式: ${pattern.name}`
                });
            }
        }

        // 3. 模板字面量深度审计 (检查 ${...} 中是否包含代码逻辑)
        if (target.includes('${')) {
            try {
                const safeTarget = target.replace(/`/g, '\\`');
                const expr = parseExpression('`' + safeTarget + '`');
                if (t.isTemplateLiteral(expr)) {
                    for (const expression of expr.expressions) {
                        // 如果表达式不是简单的 Identifier 或 MemberExpression，则视为风险
                        if (!t.isIdentifier(expression) && !t.isMemberExpression(expression)) {
                            issues.push({
                                severity: 'warning',
                                message: `模板字符串包含复杂的执行逻辑: ${generate(expression).code}`
                            });
                        }
                    }
                }
            } catch (e) {
                // 如果解析失败，说明可能是畸形的语法，这通常在 validateTargetSyntax 中处理
            }
        }

        return issues;
    }

    /**
     * 验证目标翻译内容的语法合法性
     * @param target 目标翻译字符串
     * @returns boolean 是否合法
     */
    public validateTargetSyntax(target: string): boolean {
        try {
            // 1. 基础字符串验证 (简单字符串直接通过)
            if (!target.includes('${') && !target.includes('`')) {
                return true;
            }

            // 2. 尝试作为模板字面量解析
            // 处理转义字符
            const safeTarget = target.replace(/`/g, '\\`');
            parseExpression('`' + safeTarget + '`', {
                plugins: ["typescript", "jsx", "classProperties", "objectRestSpread", "optionalChaining", "nullishCoalescingOperator", "decorators-legacy"]
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 克隆 AST 节点 (深拷贝)
     */
    public cloneAst(ast: t.Node): t.Node {
        return t.cloneNode(ast, true);
    }

    // ====================================================================================================
    //                                      2. Content Validation
    // ====================================================================================================

    /**
     * 判断文本内容是否是有效的 UI 文本
     * 策略：必须通过 REJECT 检查，且必须满足至少一个 VALID 特征
     */
    private isValidText(text: string): boolean {
        // 0. 基础长度
        if (!text || text.length < 2) return false;

        // 0.1 系统强硬排除：DOM 事件名与硬编码逻辑词
        const lower = text.toLowerCase();
        if (DOM_EVENT_NAMES.has(lower) || HARDCODED_WORDS.has(text)) {
            return false;
        }

        // 1. 拒绝匹配任何 REJECT 模式
        if (this.contentRules.REJECT_PATTERNS.some((regex: RegExp) => regex.test(text))) {
            return false;
        }

        // 2. 如果满足 VALID 特征 (空格/中文/标点/首字母大写等)，直接允许
        if (this.contentRules.VALID_PATTERNS.some((regex: RegExp) => regex.test(text))) {
            return true;
        }

        // 3. 兜底策略：如果是纯英文单词 (不含特殊符号) 且超过一定长度，通常也是合法的 UI 文本
        if (/^[A-Za-z]{2,}$/.test(text)) {
            return true;
        }

        // 4. 默认拒绝 (对无特征且非纯单词的内容保持谨慎)
        return false;
    }

    // ====================================================================================================
    //                                      3. AST Traversal
    // ====================================================================================================

    /**
     * 白名单遍历器 (用于提取)
     * 只访问 settings 中明确列出的上下文
     */
    private traverseWhitelist(
        ast: t.Node,
        callback: (
            type: string,
            name: string,
            valueNode: t.StringLiteral | t.TemplateLiteral,
            extra?: { propKey?: string; argIndex?: number }
        ) => void
    ) {
        const isFrameworkCreateCall = (name: string, node: t.CallExpression | t.NewExpression): boolean => {
            if (!FRAMEWORK_CREATE_FUNCS.has(name)) return true;
            // 框架签名: fn(tag, props, ...children)，props 为对象或 null。
            // 无 props 或 props 非对象/null 时视为用户自定义同名函数，跳过提取。
            const props = node.arguments[1];
            return !!props && (t.isObjectExpression(props) || t.isNullLiteral(props));
        };
        traverse(ast, {
            // 1. 变量声明 (const title = "...")
            VariableDeclarator: (path) => {
                const node = path.node;
                const name = t.isIdentifier(node.id) ? node.id.name : null;
                if (name && this.config.assignments.includes(name) && this.isStrNode(node.init)) {
                    callback('VariableDeclarator', name, node.init);
                }
            },
            // 2. 赋值表达式 (obj.title = "...")
            AssignmentExpression: (path) => {
                const node = path.node;
                const name = this.getAssignName(node.left);
                if (name && this.config.assignments.includes(name) && this.isStrNode(node.right)) {
                    callback('AssignmentExpression', name, node.right);
                }
            },
            // 3. 对象属性 ({ name: "..." })
            ObjectProperty: (path) => {
                const node = path.node;
                const name = this.getObjKeyName(node.key);
                if (name && this.config.keys.includes(name) && !this.isStructuralKey(name) && this.isStrNode(node.value)) {
                    callback('ObjectProperty', name, node.value, { propKey: name });
                }
            },
            // 4. 函数调用 (Notice("..."))
            CallExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee);
                if (name && this.config.functions.includes(name) && isFrameworkCreateCall(name, node)) {
                    const skipArgs = this.getShorthandSkipArgs(name);
                    node.arguments.forEach((arg, index) => {
                        // createEl("div", "cls-shorthand") 这类位置参数属于 DOM 结构，跳过
                        if (skipArgs.includes(index)) return;
                        if (this.isStrNode(arg)) {
                            callback('CallExpression', name, arg, { argIndex: index });
                        } else if (t.isObjectExpression(arg)) {
                            // 深度提取：提取白名单函数参数对象中的所有字符串值 (排除结构性键)
                            arg.properties.forEach(prop => {
                                if (t.isObjectProperty(prop)) {
                                    const propName = this.getObjKeyName(prop.key) || 'prop';
                                    if (!this.isStructuralKey(propName, name)) {
                                        if (this.isStrNode(prop.value)) {
                                            callback('ObjectProperty', propName, prop.value, { propKey: propName });
                                        } else if (t.isArrayExpression(prop.value)) {
                                            // children 数组 (如 { children: ["a", "b"] })
                                            prop.value.elements.forEach(el => {
                                                if (this.isStrNode(el)) callback('ObjectProperty', propName, el, { propKey: propName });
                                            });
                                        }
                                    }
                                }
                            });
                        } else if (t.isArrayExpression(arg)) {
                            // 顶层 children 数组 (如 jsx("div", null, "a", ["b"]))
                            arg.elements.forEach(el => {
                                if (this.isStrNode(el)) callback('CallExpression', name, el, { argIndex: index });
                            });
                        }
                    });
                }
            },
            // 5. 构造函数 (new Notice("..."))
            NewExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee);
                if (name && this.config.functions.includes(name) && isFrameworkCreateCall(name, node)) {
                    const skipArgs = this.getShorthandSkipArgs(name);
                    node.arguments.forEach((arg, index) => {
                        if (skipArgs.includes(index)) return;
                        if (this.isStrNode(arg)) {
                            callback('NewExpression', name, arg, { argIndex: index });
                        } else if (t.isObjectExpression(arg)) {
                            // 深度提取
                            arg.properties.forEach(prop => {
                                if (t.isObjectProperty(prop)) {
                                    const propName = this.getObjKeyName(prop.key) || 'prop';
                                    if (!this.isStructuralKey(propName, name)) {
                                        if (this.isStrNode(prop.value)) {
                                            callback('ObjectProperty', propName, prop.value, { propKey: propName });
                                        } else if (t.isArrayExpression(prop.value)) {
                                            prop.value.elements.forEach(el => {
                                                if (this.isStrNode(el)) callback('ObjectProperty', propName, el, { propKey: propName });
                                            });
                                        }
                                    }
                                }
                            });
                        } else if (t.isArrayExpression(arg)) {
                            arg.elements.forEach(el => {
                                if (this.isStrNode(el)) callback('NewExpression', name, el, { argIndex: index });
                            });
                        }
                    });
                }
            }
        });
    }

    /**
     * 全字符串遍历器 (用于翻译)
     * 遍历所有字符串节点，不受白名单限制
     *
     * 回调的第四个参数 `safe` 表示该字符串是否「不参与程序逻辑」。
     * 只有 safe 为 true 时才允许使用宽松匹配 (仅按 source 文本) 回退。
     * 回调的第五个参数 `structural` 表示该字符串属于 DOM 结构信息 (类名 / 标签名 / 标识符)，
     * 无论严格还是宽松匹配都必须跳过，否则会破坏样式与选择器。
     * 回调的第六个参数 `logic` 为 null 表示安全；否则为该字符串参与程序逻辑的原因详情。
     */
    private traverseAllStrings(
        ast: t.Node,
        callback: (
            type: string,
            name: string,
            valueNode: t.StringLiteral | t.TemplateLiteral,
            safe: boolean,
            structural: boolean,
            logic?: LogicStringInfo | null
        ) => void
    ) {
        /** 上报一个字符串节点，并同步计算其上下文安全性 */
        const report = (
            strPath: any,
            type: string,
            name: string,
            valueNode: t.StringLiteral | t.TemplateLiteral
        ) => {
            const logic = this.logicStringReason(strPath);
            callback(type, name, valueNode, logic === null, this.isStructuralContext(strPath), logic);
        };

        traverse(ast, {
            VariableDeclarator: (path) => {
                const node = path.node;
                const name = t.isIdentifier(node.id) ? node.id.name : 'var';
                if (this.isStrNode(node.init)) {
                    report(path.get('init'), 'VariableDeclarator', name, node.init);
                }
            },
            AssignmentExpression: (path) => {
                const node = path.node;
                const name = this.getAssignName(node.left) || 'assign';
                if (this.isStrNode(node.right)) {
                    report(path.get('right'), 'AssignmentExpression', name, node.right);
                }
            },
            ObjectProperty: (path) => {
                const node = path.node;
                const name = this.getObjKeyName(node.key) || 'prop';
                if (this.isStrNode(node.value)) {
                    report(path.get('value'), 'ObjectProperty', name, node.value);
                } else if (t.isArrayExpression(node.value)) {
                    // children 数组 (如 { children: ["a", "b"] })，与提取侧对称
                    const elPaths = path.get('value').get('elements') as any[];
                    elPaths.forEach(elPath => {
                        if (elPath && elPath.node && this.isStrNode(elPath.node)) {
                            report(elPath, 'ObjectProperty', name, elPath.node);
                        }
                    });
                }
            },
            CallExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee) || 'func';
                const argPaths = path.get('arguments') as any[];
                node.arguments.forEach((arg, index) => {
                    if (this.isStrNode(arg)) {
                        report(argPaths[index], 'CallExpression', name, arg);
                    } else if (t.isArrayExpression(arg)) {
                        // 顶层 children 数组 (如 jsx("div", null, "a", ["b"]))，与提取侧对称
                        const elPaths = (argPaths[index] as any).get('elements') as any[];
                        elPaths.forEach(elPath => {
                            if (elPath && elPath.node && this.isStrNode(elPath.node)) {
                                report(elPath, 'CallExpression', name, elPath.node);
                            }
                        });
                    }
                });
            },
            NewExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee) || 'new';
                const argPaths = path.get('arguments') as any[];
                node.arguments.forEach((arg, index) => {
                    if (this.isStrNode(arg)) {
                        report(argPaths[index], 'NewExpression', name, arg);
                    } else if (t.isArrayExpression(arg)) {
                        const elPaths = (argPaths[index] as any).get('elements') as any[];
                        elPaths.forEach(elPath => {
                            if (elPath && elPath.node && this.isStrNode(elPath.node)) {
                                report(elPath, 'NewExpression', name, elPath.node);
                            }
                        });
                    }
                });
            }
        });
    }

    /**
     * 判断字符串节点是否参与程序逻辑 (不可翻译)
     * 参与逻辑的字符串翻译后会导致判断/比较/分支/事件监听静默失效
     *
     * @param path 字符串字面量自身的 NodePath
     */
    public isLogicString(path: any): boolean {
        return this.logicStringReason(path) !== null;
    }

    /**
     * 判定字符串节点参与程序逻辑的原因
     * 参与逻辑的字符串翻译后会导致判断/比较/分支/事件监听静默失效
     *
     * @param path 字符串字面量自身的 NodePath
     * @returns 命中时返回原因与上下文，安全时返回 null
     */
    private logicStringReason(path: any): LogicStringInfo | null {
        if (!path || !path.parentPath) return null;

        const node = path.node;
        const parent = path.parentPath.node;
        if (!node || !parent) return null;

        /** 提取调用方法名: fn("x") -> fn, obj.startsWith("x") -> startsWith */
        const getMethodName = (callee: any): string | null => {
            if (t.isIdentifier(callee)) return callee.name;
            if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) return callee.property.name;
            return null;
        };

        // 1. 字符串方法调用: x.startsWith("abc") / x.includes("abc")
        if (t.isCallExpression(parent) && Array.isArray(parent.arguments) && parent.arguments.includes(node)) {
            const methodName = getMethodName(parent.callee);
            if (methodName && LOGIC_STRING_METHODS.has(methodName)) return { reason: 'method', context: methodName };
        }

        // 2. 二元比较 / 成员判定: x === "abc" / "abc" === x / "abc" in obj
        if (t.isBinaryExpression(parent) && LOGIC_BINARY_OPERATORS.has(parent.operator)) {
            return { reason: 'binary', context: parent.operator };
        }

        // 3. switch case 分支值
        if (t.isSwitchCase(parent) && parent.test === node) return { reason: 'switch', context: 'case' };

        // 4. 对象键 (计算属性除外)
        if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) {
            return { reason: 'objectKey', context: 'key' };
        }

        // 5. 硬编码依赖词 (模块互操作 / 语言关键字) 与 DOM 事件名
        const raw = this.extractSource(node);
        if (raw && DOM_EVENT_NAMES.has(raw.toLowerCase())) return { reason: 'eventName', context: raw };
        if (raw && HARDCODED_WORDS.has(raw)) return { reason: 'hardcoded', context: raw };

        // 6. 事件注册方法的第一个参数 (事件名)
        // addEventListener('mousemove', ...) / on('change', ...) / emit('close')
        // 翻译后事件监听器静默失效，不报错但功能完全失效
        if (t.isCallExpression(parent) && Array.isArray(parent.arguments) && parent.arguments[0] === node) {
            const methodName = getMethodName(parent.callee);
            if (methodName && EVENT_LISTENER_METHODS.has(methodName)) return { reason: 'event', context: methodName };
        }

        return null;
    }

    /**
     * 判断对象键是否属于结构性键 (其值为类名 / 选择器 / 标识符 / 机器取值，不可翻译)
     * @param key 对象键名
     * @param fnName 所在的函数调用名 (用于区分 DOM 创建函数上下文)
     */
    private isStructuralKey(key: string, fnName?: string | null): boolean {
        const k = (key || '').toLowerCase();
        if (STRUCTURAL_KEYS.has(k)) return true;
        // data-* 自定义属性 / dataset 成员
        if (/^data[-A-Z]/.test(key)) return true;
        // createEl('input', { name: 'group1' })：HTML name 属性是分组标识
        if (fnName && this.getShorthandSkipArgs(fnName).length > 0 && DOM_CREATE_STRUCTURAL_KEYS.has(k)) return true;
        return false;
    }

    /**
     * 安全读取 DOM 创建函数的「不可翻译位置参数」索引
     *
     * DOM_CREATE_SHORTHAND_ARGS 是普通对象字面量，带 Object.prototype 原型链。
     * getCallName 对成员调用返回属性名，因此 x.toString("literal") 会得到 fnName = 'toString'，
     * 直接索引会取到 Object.prototype.toString (函数)，后续 .includes(index) 即
     * "TypeError: ... includes is not a function"。此处只认自有属性并校验数组类型。
     */
    private getShorthandSkipArgs(fnName: string | null | undefined): number[] {
        if (!fnName) return [];
        if (!Object.prototype.hasOwnProperty.call(DOM_CREATE_SHORTHAND_ARGS, fnName)) return [];
        const args = DOM_CREATE_SHORTHAND_ARGS[fnName];
        return Array.isArray(args) ? args : [];
    }

    /**
     * 判断字符串节点是否处于 DOM 结构位置 (不可翻译)
     * 1. 结构性对象键的值: { cls: "..." } / { id: "..." }
     * 2. DOM 创建函数的简写参数: createDiv("message-segment markdown-rendered") / createEl("div", "cls")
     *
     * @param path 字符串字面量自身的 NodePath
     */
    private isStructuralContext(path: any): boolean {
        const node = path?.node;
        const parent = path?.parentPath?.node;
        if (!node || !parent) return false;

        // 1. 对象属性的值
        if (t.isObjectProperty(parent) && parent.value === node && !parent.computed) {
            const keyName = this.getObjKeyName(parent.key);
            if (keyName && this.isStructuralKey(keyName)) return true;
        }

        // 2. 函数调用的位置参数
        if ((t.isCallExpression(parent) || t.isNewExpression(parent)) && Array.isArray(parent.arguments)) {
            const index = (parent.arguments as any[]).indexOf(node);
            const fnName = this.getCallName(parent.callee);
            if (index >= 0 && this.getShorthandSkipArgs(fnName).includes(index)) return true;
        }

        // 3. 数组元素：字符串的父节点是 ArrayExpression，向上再看一层。
        // 数组本身处于结构性位置 (如 { className: ["foo"] } 的数组值、
        // createDiv(["foo"]) 的简写参数数组) 时，其字符串元素同样不可翻译，
        // 否则会误替换 CSS 类名 / 标识符，导致样式静默损坏。
        if (t.isArrayExpression(parent)) {
            const grand = path.parentPath.parentPath?.node;
            if (!grand) return false;
            if (t.isObjectProperty(grand) && grand.value === parent && !grand.computed) {
                const keyName = this.getObjKeyName(grand.key);
                if (keyName && this.isStructuralKey(keyName)) return true;
            }
            if ((t.isCallExpression(grand) || t.isNewExpression(grand)) && Array.isArray(grand.arguments)) {
                const index = (grand.arguments as any[]).indexOf(parent);
                const fnName = this.getCallName(grand.callee);
                if (index >= 0 && this.getShorthandSkipArgs(fnName).includes(index)) return true;
            }
        }

        return false;
    }

    /**
     * 字面量是否处于提取白名单上下文 (与 extract 的遍历口径对齐)
     * 用于收紧宽松回退：仅当字面量确实落在 UI 文案上下文 (白名单的 变量/赋值/对象键/函数调用)
     * 时才允许按 source 文本兜底替换，避免把内部 action 常量 (如 s('REMOVE',…)) 一并改写。
     */
    private isWhitelistedContext(type: string, name: string): boolean {
        if (!name) return false;
        if (type === 'VariableDeclarator' || type === 'AssignmentExpression') {
            return this.config.assignments.includes(name);
        }
        if (type === 'ObjectProperty') {
            return this.config.keys.includes(name) && !this.isStructuralKey(name);
        }
        if (type === 'CallExpression' || type === 'NewExpression') {
            return this.config.functions.includes(name);
        }
        return false;
    }

    // ====================================================================================================
    //                                      4. Helpers
    // ====================================================================================================

    private parseAst(code: string, isModule: boolean) {
        try {
            return parse(code, {
                sourceType: isModule ? 'module' : 'script',
                attachComment: false,
                plugins: [
                    "typescript", "jsx", "classProperties", "objectRestSpread",
                    "optionalChaining", "nullishCoalescingOperator", "decorators-legacy"
                ],
                errorRecovery: true
            });
        } catch (e) {
            console.warn("AST Parse Error:", (e as Error).message?.split('\n')[0]);
            return null;
        }
    }

    private isStrNode(node: any): node is t.StringLiteral | t.TemplateLiteral {
        return t.isStringLiteral(node) || t.isTemplateLiteral(node);
    }

    private extractSource(node: t.StringLiteral | t.TemplateLiteral): string {
        if (t.isStringLiteral(node)) return node.value;
        if (t.isTemplateLiteral(node) && node.quasis.length === 1) {
            return node.quasis[0].value.raw;
        }
        return "";
    }

    private replaceSource(node: t.StringLiteral | t.TemplateLiteral, target: string) {
        if (!target.includes('${')) {
            if (t.isStringLiteral(node)) node.value = target;
            else {
                node.quasis = [t.templateElement({ raw: target, cooked: target }, true)];
                node.expressions = [];
            }
            return;
        }
        try {
            const safeTarget = target.replace(/`/g, '\\`');
            const ast = parseExpression('`' + safeTarget + '`');
            if (t.isTemplateLiteral(ast)) {
                Object.assign(node, { type: 'TemplateLiteral', quasis: ast.quasis, expressions: ast.expressions });
            }
        } catch (e) { /* ignore */ }
    }

    private getAssignName(node: t.Node): string | null {
        if (t.isIdentifier(node)) return node.name;
        if (t.isMemberExpression(node)) {
            if (t.isIdentifier(node.property)) return node.property.name;
            if (t.isStringLiteral(node.property)) return node.property.value;
        }
        return null;
    }

    private getObjKeyName(key: t.Node): string | null {
        if (t.isIdentifier(key)) return key.name;
        if (t.isStringLiteral(key)) return key.value;
        return null;
    }

    private getCallName(node: t.Node): string | null {
        if (t.isIdentifier(node)) return node.name;
        if (t.isMemberExpression(node)) return this.getCallName(node.property);
        return null;
    }

    /**
     * 在 AST 中查找目标文本的位置
     * @param targetText 目标文本
     * @param ast AST 节点
     * @returns 匹配项列表
     */
    public findString(targetText: string, ast: t.Node): { line: number, column: number, type: string, name: string, source: string }[] {
        const matches: { line: number, column: number, type: string, name: string, source: string }[] = [];

        this.traverseAllStrings(ast, (type, name, valueNode) => {
            const source = this.extractSource(valueNode);
            if (source && source.includes(targetText)) {
                const loc = valueNode.loc?.start;
                matches.push({
                    line: loc?.line || 0,
                    column: loc?.column || 0,
                    type,
                    name,
                    source
                });
            }
        });

        return matches;
    }

    private getFingerprint(item: { type: string, name: string, source: string }) {
        return `${item.type}:${item.name}:${item.source}`;
    }

    private deduplicateResults(results: PluginTranslationV1Ast[]) {
        const map = new Map();
        results.forEach(r => map.set(this.getFingerprint(r), r));
        return Array.from(map.values()).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    }
}
