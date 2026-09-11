import fs from 'fs';
import { PluginTranslationV1Regex } from '~/types';
// 仅类型依赖：用 import type 保证被完全擦除，便于单测直接加载本类
import type { I18nSettings } from 'src/settings/data';

import { REGEX_DEFAULT_CONFIG, DOM_EVENT_NAMES, HARDCODED_WORDS } from './config';

// Regex 翻译器

// #region 配置和类型定义 ==================================================
/** JavaScript 代码语法验证的结果信息 */
export interface RegexValidationResult {
    /** 代码是否合法  */
    success: boolean;
    /** 验证成功的节点类型 */
    // type: string | null;
    /** 验证失败的错误信息 */
    message: string;
}

/** 从代码中提取字符串的结果信息 */
export interface RegexExtractionResult {
    /** 提取操作是否成功（true 表示成功，false 表示失败） */
    success: boolean;
    /** 解析成功的节点类型 */
    // type: string | null;
    /** 提取到的字符串数组 */
    texts: string[];
}

// #endregion

// ------------------------------
// 核心类（优化：预编译、缓存、配置化）
// ------------------------------
/** 转义正则元字符，使字符串可作为字面量参与 RegExp 构造 */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class RegexTranslator {
    private settings: I18nSettings;
    // [变量] 正则表达式模式 (预编译)
    private patterns: RegExp[];
    private rejectPatterns: RegExp[] = [];
    private validPatterns: RegExp[] = [];

    // 初始化变量
    constructor(settings: I18nSettings) {
        this.settings = settings;
        this.initPatterns();
    }

    private initPatterns() {
        // 初始化核心匹配正则
        const regexps = (this.settings.reDatas && this.settings.reDatas.length > 0)
            ? this.settings.reDatas
            : REGEX_DEFAULT_CONFIG.patterns;

        this.patterns = regexps.filter(p => p !== '').map(p => new RegExp(p, this.settings.reFlags || 'gs'));

        // 初始化过滤正则 (排除型：合并系统默认排除规则与用户自定义排除规则)
        const userReject = (this.settings.reRejectRe || []).map(p => {
            try { return new RegExp(p); } catch { return null; }
        }).filter(Boolean) as RegExp[];
        const systemReject = REGEX_DEFAULT_CONFIG.rejectPatterns.map(p => new RegExp(p));
        this.rejectPatterns = [...systemReject, ...userReject];

        // 初始化验证正则 (有效型)
        const validRes = (this.settings.reValidRe && this.settings.reValidRe.length > 0)
            ? this.settings.reValidRe
            : REGEX_DEFAULT_CONFIG.validPatterns;
        this.validPatterns = validRes.map(p => new RegExp(p));
    }

    private isValidText(text: string): boolean {
        if (!text || text.length > this.settings.reLength) return false;

        // 0. 系统强硬排除：DOM 事件名与硬编码保留词
        const lower = text.toLowerCase();
        if (DOM_EVENT_NAMES.has(lower) || HARDCODED_WORDS.has(text)) {
            return false;
        }

        // 1. 检查排除正则 (命中任一则排除)
        for (const re of this.rejectPatterns) {
            if (re.test(text)) return false;
        }

        // 2. 检查有效正则 (命中任一则视为有效; 若列表为空则默认有效)
        if (this.validPatterns.length === 0) return true;
        for (const re of this.validPatterns) {
            if (re.test(text)) return true;
        }

        return false;
    }

    /**
     * 加载文件并解析JavaScript代码
     * 
     * @param filePath 要读取的JavaScript文件的路径
     * @returns 解析成功时返回提取结果，文件读取失败时返回null 
     */
    public loadFile(filePath: string) {
        let code = ''
        try {
            code = fs.readFileSync(filePath, 'utf8');
            return this.extractTranslationsByRegex(code);
        } catch (err: any) {
            return null;
        }
    }

    /**
     * 加载文本并解析JavaScript代码
     * 
     * @param code 要加载和解析的JavaScript代码字符串
     * @returns 解析成功时返回提取结果，解析失败时返回null
     */
    public loadCode(code: string) {
        try {
            return this.extractTranslationsByRegex(code);
        } catch (err: any) {
            return null;
        }
    }


    /**
     * 验证翻译项安全性 (精准版)
     * @param target 目标翻译字符串
     * @param source 原始代码匹配出的原文 (用于上下文分析)
     */
    public validateSecurity(target: string, source: string = ""): { severity: 'critical' | 'warning', message: string }[] {
        const issues: { severity: 'critical' | 'warning', message: string }[] = [];
        if (!target) return issues;

        // 1. 精准结构破坏检测 (仅当包含可能导致当前容器闭合的引号且未转义时报错)
        // 尝试从 source 中探测包裹引号
        const trimmedSource = source.trim();
        const startChar = trimmedSource[0];
        const endChar = trimmedSource[trimmedSource.length - 1];

        // 只有当原文被引号包裹时，才需要检查同名引号的溢出
        const quotes = ['"', "'", '`'];
        if (quotes.includes(startChar) && startChar === endChar) {
            const quoteName = startChar === '"' ? '双引号' : (startChar === "'" ? '单引号' : '反引号');

            const hasUnescapedQuote = (str: string, q: string) => {
                let escaped = false;
                for (let i = 0; i < str.length; i++) {
                    if (str[i] === '\\') {
                        escaped = !escaped;
                    } else if (str[i] === q) {
                        if (!escaped) return true;
                        escaped = false;
                    } else {
                        escaped = false;
                    }
                }
                return false;
            };

            if (hasUnescapedQuote(target, startChar)) {
                issues.push({
                    severity: 'warning',
                    message: `潜在的结构破坏风险: 包含未转义的${quoteName}，可能导致代码逃逸`
                });

                // 特殊检查：分号通常紧随引号闭合后，如果包含分号且包含引号，风险更高
                if (target.includes(';')) {
                    issues.push({
                        severity: 'critical',
                        message: `高危结构破坏风险: 检测到引号配对与分号组合，可能存在指令注入`
                    });
                }
            }
        }

        // 2. 指令级精确匹配 (使用 \b 单词边界)
        const criticalPatterns = [
            { regex: /\beval\s*\(/i, name: 'eval()' },
            { regex: /\bFunction\s*\(/i, name: 'new Function()' },
            { regex: /\bsetTimeout\s*\(\s*['"`]/i, name: 'setTimeout(string)' },
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

        // 3. 可疑行为检测
        const warningKeywords = [
            { regex: /\bfetch\s*\(/i, name: 'fetch()' },
            { regex: /\bXMLHttpRequest\b/i, name: 'XMLHttpRequest' },
            { regex: /\brequire\s*\(/i, name: 'require()' },
            { regex: /\bprocess\./i, name: 'Node.js process' },
            { regex: /\belectron\./i, name: 'Electron API' },
            { regex: /\blocalStorage\b/i, name: 'localStorage' },
        ];

        for (const kw of warningKeywords) {
            if (kw.regex.test(target)) {
                issues.push({
                    severity: 'warning',
                    message: `内容包含可疑敏感操作: ${kw.name}`
                });
            }
        }

        return issues;
    }

    public extractTranslationsByRegex(code: string): PluginTranslationV1Regex[] {
        const translations: PluginTranslationV1Regex[] = [];
        // 用Set存储已添加的source，优化去重效率（O(1)查找）
        const seenSources = new Set<string>();

        // 遍历所有模式提取翻译条目
        for (const regex of this.patterns) {
            // regex 是预编译的 stateful RegExp ('g' flag)，循环前需重置 lastIndex
            regex.lastIndex = 0;

            const matches = code.match(regex);
            if (!matches) continue; // 无匹配结果则跳过

            // 遍历匹配结果，过滤并去重
            for (const item of matches) {
                // 使用统一的过滤校验逻辑
                if (!this.isValidText(item)) continue;
                // 利用Set快速判断是否重复
                if (seenSources.has(item)) continue;
                // 不重复则添加到结果集
                seenSources.add(item);
                translations.push({ source: item, target: item });
            }
        }

        return translations;
    }

    /**
     * 应用正则翻译项
     *
     * BUG-001 关联缺陷: 原实现为纯文本全局替换 (split/join)，不校验引号边界。
     * 当 source 不含引号时 (如 default)，会连同 .default 属性访问、标识符中的 default
     * 一并替换，直接产出语法错误。此处按 source 的引号特征分流处理。
     */
    public translate(code: string, translations: PluginTranslationV1Regex[]): string {
        let translatedCode = code;
        for (const item of translations) {
            // 人工标记「不需要翻译」的条目不参与替换。
            // translate 与 traceUsage 必须同口径，否则未用诊断会把不生效的条目误报成「已使用」
            if (item.ignored === true) continue;
            if (!item.source || !item.target || item.source === item.target) continue;
            translatedCode = this.replaceLiteral(translatedCode, item.source, item.target);
        }
        return translatedCode;
    }

    /**
     * 跟踪正则项的使用情况
     * @param code 源代码
     * @param translations 翻译项
     * @returns 被命中的翻译项 source 集合 (口径与 translate() 保持一致)
     */
    public traceUsage(code: string, translations: PluginTranslationV1Regex[]): Set<string> {
        const hitSources = new Set<string>();
        for (const item of translations) {
            // 与 translate() 同口径：人工标记「不需要翻译」的条目不参与替换，也不该被算作「已使用」
            if (item.ignored === true) continue;
            if (item.source && this.hasMatch(code, item.source)) {
                hitSources.add(item.source);
            }
        }
        return hitSources;
    }

    /**
     * 安全地执行一次字面量替换
     * - source 是带配对引号的字符串字面量 (如 "Cancel")：整体替换，并保证译文带同样的引号
     * - source 内部含引号 (如 Notice("Cancel"))：匹配体已自带边界，按字面量整体替换
     * - source 不含引号 (如 default)：仅替换目标代码中被引号完整包裹的片段，
     *   避免破坏 .default / defaultValue 等属性访问与标识符
     */
    private replaceLiteral(code: string, source: string, target: string): string {
        const wrap = this.getQuoteWrap(source);

        if (wrap) {
            const safeTarget = this.getQuoteWrap(target) ? target : `${wrap.quote}${target}${wrap.quote}`;
            return code.split(source).join(safeTarget);
        }

        if (/["'`]/.test(source)) {
            return code.split(source).join(target);
        }

        const innerTarget = this.getQuoteWrap(target)?.inner ?? target;
        const quoted = new RegExp(`(["'\`])${escapeRegExp(source)}\\1`, 'g');
        return code.replace(quoted, (_match, quote: string) => `${quote}${innerTarget}${quote}`);
    }

    /** 判断 source 在目标代码中是否真的存在可替换点 (与 replaceLiteral 口径一致) */
    private hasMatch(code: string, source: string): boolean {
        if (this.getQuoteWrap(source) || /["'`]/.test(source)) return code.includes(source);
        return new RegExp(`(["'\`])${escapeRegExp(source)}\\1`).test(code);
    }

    /** 解析文本外层的配对引号 (如 "Cancel" → { quote: '"', inner: 'Cancel' })，无则解析失败返回 null */
    private getQuoteWrap(text: string): { quote: string, inner: string } | null {
        if (!text || text.length < 2) return null;
        const quote = text[0];
        if (quote !== '"' && quote !== "'" && quote !== '`') return null;
        if (text[text.length - 1] !== quote) return null;
        return { quote, inner: text.slice(1, -1) };
    }

    /**
     * 在源码中通过正则查找目标文本的位置
     * @param targetText 目标文本
     * @param code 源代码
     * @returns 匹配项列表
     */
    public findString(targetText: string, code: string): { line: number, source: string }[] {
        const matches: { line: number, source: string }[] = [];
        const lines = code.split('\n');

        lines.forEach((line, index) => {
            if (line.includes(targetText)) {
                matches.push({
                    line: index + 1,
                    source: line.trim()
                });
            }
        });

        return matches;
    }

};

// ------------------------------
// 工具类 (已禁用 AST 分析功能)
// ------------------------------

/**
 * [已禁用] 验证JavaScript代码片段的语法是否合法
 * 始终返回 true
 */
export const validationJavaScriptCode = (code: string): RegexValidationResult => {
    return { success: true, message: '' };
};

/**
 * [已禁用] 从JavaScript代码片段中提取所有字符串内容
 * 始终返回空数组
 */
export const extractionJavaScriptCode = (code: string): RegexExtractionResult => {
    return { success: true, texts: [] };
};