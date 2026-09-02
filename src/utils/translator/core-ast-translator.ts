import fs from 'fs';
import { parse, parseExpression } from "@babel/parser";
import traverse from '@babel/traverse';
import { generate } from "@babel/generator";
import * as t from '@babel/types';
import { PluginTranslationV1Ast } from '~/types';
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
    DOM_CREATE_SHORTHAND_ARGS, STRUCTURAL_KEYS, DOM_CREATE_STRUCTURAL_KEYS
} from './config';

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

        this.traverseWhitelist(ast, (type, name, valueNode) => {
            const source = this.extractSource(valueNode);
            // 双重校验：上下文白名单 (implicit) + 内容有效性 (explicit)
            if (source && this.isValidText(source)) {
                results.push({ type, name, source, target: source });
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
            if (!target && allowLoose && safe) {
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
            } else if (allowLoose && safe && looseMap.has(source)) {
                // 如果严格匹配失败但宽松匹配成功，记录下宽松匹配的标示
                hitFingerprints.add(source);
            }
        });

        return hitFingerprints;
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
    private traverseWhitelist(ast: t.Node, callback: (type: string, name: string, valueNode: t.StringLiteral | t.TemplateLiteral) => void) {
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
                    callback('ObjectProperty', name, node.value);
                }
            },
            // 4. 函数调用 (Notice("..."))
            CallExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee);
                if (name && this.config.functions.includes(name)) {
                    const skipArgs = DOM_CREATE_SHORTHAND_ARGS[name] || [];
                    node.arguments.forEach((arg, index) => {
                        // createEl("div", "cls-shorthand") 这类位置参数属于 DOM 结构，跳过
                        if (skipArgs.includes(index)) return;
                        if (this.isStrNode(arg)) {
                            callback('CallExpression', name, arg);
                        } else if (t.isObjectExpression(arg)) {
                            // 深度提取：提取白名单函数参数对象中的所有字符串值 (排除结构性键)
                            arg.properties.forEach(prop => {
                                if (t.isObjectProperty(prop)) {
                                    const propName = this.getObjKeyName(prop.key) || 'prop';
                                    if (!this.isStructuralKey(propName, name) && this.isStrNode(prop.value)) {
                                        callback('ObjectProperty', propName, prop.value);
                                    }
                                }
                            });
                        }
                    });
                }
            },
            // 5. 构造函数 (new Notice("..."))
            NewExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee);
                if (name && this.config.functions.includes(name)) {
                    const skipArgs = DOM_CREATE_SHORTHAND_ARGS[name] || [];
                    node.arguments.forEach((arg, index) => {
                        if (skipArgs.includes(index)) return;
                        if (this.isStrNode(arg)) {
                            callback('NewExpression', name, arg);
                        } else if (t.isObjectExpression(arg)) {
                            // 深度提取
                            arg.properties.forEach(prop => {
                                if (t.isObjectProperty(prop)) {
                                    const propName = this.getObjKeyName(prop.key) || 'prop';
                                    if (!this.isStructuralKey(propName, name) && this.isStrNode(prop.value)) {
                                        callback('ObjectProperty', propName, prop.value);
                                    }
                                }
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
     */
    private traverseAllStrings(
        ast: t.Node,
        callback: (type: string, name: string, valueNode: t.StringLiteral | t.TemplateLiteral, safe: boolean, structural: boolean) => void
    ) {
        /** 上报一个字符串节点，并同步计算其上下文安全性 */
        const report = (
            strPath: any,
            type: string,
            name: string,
            valueNode: t.StringLiteral | t.TemplateLiteral
        ) => {
            callback(type, name, valueNode, !this.isLogicString(strPath), this.isStructuralContext(strPath));
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
                }
            },
            CallExpression: (path) => {
                const node = path.node;
                const name = this.getCallName(node.callee) || 'func';
                const argPaths = path.get('arguments') as any[];
                node.arguments.forEach((arg, index) => {
                    if (this.isStrNode(arg)) {
                        report(argPaths[index], 'CallExpression', name, arg);
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
                    }
                });
            }
        });
    }

    /**
     * 判断字符串节点是否参与程序逻辑 (不可翻译)
     * 参与逻辑的字符串翻译后会导致判断/比较/分支失效
     *
     * @param path 字符串字面量自身的 NodePath
     */
    private isLogicString(path: any): boolean {
        if (!path || !path.parentPath) return false;

        const node = path.node;
        const parent = path.parentPath.node;
        if (!node || !parent) return false;

        // 1. 字符串方法调用: x.startsWith("abc") / x.includes("abc")
        if (t.isCallExpression(parent) && Array.isArray(parent.arguments) && parent.arguments.includes(node)) {
            const callee = parent.callee;
            let methodName: string | null = null;
            if (t.isIdentifier(callee)) methodName = callee.name;
            else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                methodName = callee.property.name;
            }
            if (methodName && LOGIC_STRING_METHODS.has(methodName)) return true;
        }

        // 2. 二元比较 / 成员判定: x === "abc" / "abc" === x / "abc" in obj
        if (t.isBinaryExpression(parent) && LOGIC_BINARY_OPERATORS.has(parent.operator)) return true;

        // 3. switch case 分支值
        if (t.isSwitchCase(parent) && parent.test === node) return true;

        // 4. 对象键 (计算属性除外)
        if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) return true;

        // 5. 硬编码依赖词 (模块互操作 / 语言关键字) 与 DOM 事件名
        const raw = this.extractSource(node);
        if (raw && (HARDCODED_WORDS.has(raw) || DOM_EVENT_NAMES.has(raw.toLowerCase()))) return true;

        // 6. 事件注册方法的第一个参数 (事件名)
        // addEventListener('mousemove', ...) / on('change', ...) / emit('close')
        // 翻译后事件监听器静默失效，不报错但功能完全失效
        if (t.isCallExpression(parent) && Array.isArray(parent.arguments) && parent.arguments[0] === node) {
            const callee = parent.callee;
            let methodName: string | null = null;
            if (t.isIdentifier(callee)) methodName = callee.name;
            else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                methodName = callee.property.name;
            }
            if (methodName && EVENT_LISTENER_METHODS.has(methodName)) return true;
        }

        return false;
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
        if (fnName && DOM_CREATE_SHORTHAND_ARGS[fnName] && DOM_CREATE_STRUCTURAL_KEYS.has(k)) return true;
        return false;
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
            const skipArgs = fnName ? DOM_CREATE_SHORTHAND_ARGS[fnName] : null;
            if (index >= 0 && skipArgs && skipArgs.includes(index)) return true;
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
