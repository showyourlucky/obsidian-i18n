import { PluginManifest } from "obsidian";

export interface PluginItem {
    id: string;
    manifest: PluginManifest;
    isApplied: boolean;
}

export enum PluginTranslationSchemaVersion {
    V1 = 1,
}

export interface PluginTranslationV1 {
    schemaVersion: PluginTranslationSchemaVersion;
    metadata: PluginTranslationV1Metadata;
    dict: Record<string, PluginTranslationFileDict>;
}

/**
 * 单个源文件的字典条目。
 * ignoredKeys 是人工「不需要翻译」标记的**镜像**，供编辑器内读写与重新提取时回标。
 * 标记的权威来源是独立的 sidecar 文件 (ignored-keys.json)：翻译源可被删除并全新提取，
 * 但人工判定知识必须比翻译源更持久，因此两者都要写，读取时以 sidecar 为准。
 * AST key 为 `type|name|source`（与 mergeAstItems 唯一标识一致），Regex key 为 source。
 */
export interface PluginTranslationFileDict {
    ast: PluginTranslationV1Ast[];
    regex: PluginTranslationV1Regex[];
    ignoredKeys?: {
        ast?: string[];
        regex?: string[];
    };
}

/**
 * 人工「不需要翻译」标记的独立持久化存储 (sidecar: ignored-keys.json)。
 * 生命周期独立于翻译源——删除所有翻译源后重新提取，标记依然可恢复。
 * 结构：插件 ID → 源文件名 → 集合。
 */
export interface IgnoredKeysStore {
    version: 1;
    plugins: Record<string, Record<string, {
        ast?: string[];
        regex?: string[];
    }>>;
}

export const EMPTY_IGNORED_KEYS: IgnoredKeysStore = {
    version: 1,
    plugins: {}
};

/**
 * 翻译记忆 (Translation Memory) 的独立持久化存储 (sidecar: translation-memory.json)。
 *
 * 生命周期独立于翻译源：翻译源可被删除并全新提取，但「某条原文曾经被翻译成什么」是
 * 已经花过成本 (AI 调用 / 人工校对) 的知识，必须比翻译源活得更久，因此单独落盘。
 *
 * 结构：插件 ID → 目标语言 → 记忆键 → 记忆条目。
 * - 记忆键是定长哈希 (sha256 前 32 位)，由 `type|name|source` 上下文派生：原文可能极长
 *   (SVG、模板字符串)，直接用原文做 JSON 键会让文件膨胀且难以读取，哈希保证键长恒定。
 * - 条目不存原文全文：匹配只依赖记忆键，原文仅保留 preview 供人工排查，避免长文本在
 *   键和值里各存一份；译文 target 必须存全文，否则长条目复用时会拿到残缺译文。
 */
export interface TranslationMemoryEntry {
    /** AST 上下文类型 (ObjectProperty / CallExpression …)；Regex 条目为空串 */
    type: string;
    /** AST 上下文名 (属性键 / 函数名 …)；Regex 条目为空串 */
    name: string;
    /** 已确认译文，存全文以保证长文本可完整复用 */
    target: string;
    /** 原文预览 (截断)，仅供人工排查，不参与匹配 */
    preview: string;
    /** 写入时间，用于同键覆盖与容量淘汰 */
    updatedAt: number;
}

export interface TranslationMemoryStore {
    version: 1;
    /** 插件 ID → 目标语言 → 记忆键(定长哈希) → 记忆条目 */
    plugins: Record<string, Record<string, Record<string, TranslationMemoryEntry>>>;
}

export const EMPTY_TRANSLATION_MEMORY: TranslationMemoryStore = {
    version: 1,
    plugins: {}
};

/**
 * 「函数 + 参数位」调用规则：提取插件自封装函数指定实参位上的字符串。
 * 适用于非框架 create* 系调用 (astFunctions 白名单要求 isFrameworkCreateCall，
 * 插件私有封装如 tr("...") / _("...") 不在其列)。
 * args 缺省为 [0]；提取时仍走常规内容过滤 (isValidText)，比选项容器豁免更保守。
 */
export interface PluginExtractRuleCall {
    /** 函数名 (getCallName 口径：Identifier 或 MemberExpression.property) */
    fn: string;
    /** 允许提取的实参下标，缺省 [0] */
    args?: number[];
}

/**
 * 单个插件的专属提取规则 (仅追加，与全局白名单取并集)。
 * 生命周期独立于翻译源 (sidecar: extract-rules.json)——规则删掉后，
 * 已提取条目靠 merge 的并集语义留在翻译文件里，行为与「临时加全局规则」一致。
 */
export interface PluginExtractRules {
    ast?: {
        keys?: string[];
        assignments?: string[];
        functions?: string[];
        optionContainers?: string[];
        callRules?: PluginExtractRuleCall[];
        nonTranslatableProps?: string[];
        translatableProps?: string[];
        rejectRe?: string[];
        validRe?: string[];
    };
    regex?: {
        patterns?: string[];
        rejectRe?: string[];
        validRe?: string[];
    };
}

/**
 * 插件专属提取规则的持久化存储。
 * 结构与 IgnoredKeysStore 同构：插件 ID → 规则集。
 */
export interface ExtractRulesStore {
    version: 1;
    plugins: Record<string, PluginExtractRules>;
}

export const EMPTY_EXTRACT_RULES: ExtractRulesStore = {
    version: 1,
    plugins: {}
};

export interface PluginTranslationV1Metadata {
    // 核心识别信息
    plugin: string;                 // 所属插件ID 
    language: string;               // 翻译包语言 (BCP 47)
    version: string;                // 翻译包自身的版本 (e.g. "1.0.1")
    supportedVersions: string;      // 使用 SemVer 范围字符串

    // UI 展示信息
    title: string;                  // 翻译包的标题
    description: string;            // 翻译包的描述
    author: string;                 // 译文创建者
}

// AI 判定状态 (C 层：选中条目经 LLM 判定是否需要翻译)
export type AiVerdict = 'unjudged' | 'translatable' | 'untranslatable';

// AST翻译条目
export interface PluginTranslationV1Ast {
    type: string;
    name: string;
    source: string;
    target: string;
    // 源码位置与结构信号 (提取阶段写入，旧文件缺省 undefined，向后兼容)
    start?: number;     // 字符偏移 (Babel node.start)
    end?: number;       // 字符偏移 (Babel node.end)
    line?: number;      // 源码行号 (1-based)，缺省 0
    col?: number;       // 列号，缺省 0
    propKey?: string;   // 所在对象属性键名 (如 placeholder/className/children)，AI 判定强信号
    argIndex?: number;  // 所在函数调用的实参下标 (如 createElement 第 0 参为标签名)，AI 判定强信号
    // AI 判定结果 (仅标注，不自动改数据)
    aiVerdict?: AiVerdict;
    aiReason?: string;
    aiConfidence?: number;
    // 人工标记：确认"不需要翻译"。与 AI 判定分离，重跑 AI 判定不会被清掉。
    ignored?: boolean;
}

// RE翻译条目
export interface PluginTranslationV1Regex {
    source: string;
    target: string;
    // 人工标记：确认"不需要翻译"。与 AI 判定分离，重跑 AI 判定不会被清掉。
    ignored?: boolean;
}
