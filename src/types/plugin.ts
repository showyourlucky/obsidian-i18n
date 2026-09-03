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
