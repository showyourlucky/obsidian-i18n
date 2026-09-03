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
    dict: Record<string, {
        ast: PluginTranslationV1Ast[];
        regex: PluginTranslationV1Regex[];
    }>;
}

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
}

// RE翻译条目
export interface PluginTranslationV1Regex {
    source: string;
    target: string;
}
