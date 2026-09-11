/**
 * 文件名称: translation.ts
 * 模块描述: 翻译数据生成核心模块，负责从插件和主题文件中提取可翻译字符串并构建标准化翻译结构
 * 核心功能:
 *   - 解析插件manifest与源码字符串，生成包含版本信息和翻译字典的插件翻译JSON
 *   - 提取主题manifest与设置注释中的可翻译文本，构建主题翻译数据结构
 *   - 通过正则表达式匹配关键字符串，自动生成初始翻译字典
 *
 * 开发人员: zero
 * 维护人员: zero
 * 创建日期: 2025-08-15
 *
 * 修改日期:
 *   - 2025-08-15 [v1.0.0] zero: 初始版本，实现基础功能;
 *
 * 注意事项: 
 *   - 依赖 <mcsymbol name="PluginManifest" filename="types.ts" path="src/data/types.ts" startline="1" type="interface"></mcsymbol> 和 <mcsymbol name="OBThemeManifest" filename="types.ts" path="src/data/types.ts" startline="10" type="interface"></mcsymbol> 类型定义
 *   - 正则表达式匹配规则需根据实际字符串模式调整，避免过度匹配
 *   - 处理大型文件时可能存在性能瓶颈，建议增加分批处理机制
 *   - 生成的翻译字典需人工校对，自动提取可能包含无效字符串
 */

import { createHash } from 'crypto';
import { ThemeTranslationV1Metadata } from "@/src/types";
import { PluginManifest } from 'obsidian';
import { OBThemeManifest, ThemeTranslationV1, ThemeTranslationSchemaVersion, ThemeTranslationItem, PluginTranslationV1, PluginTranslationSchemaVersion, PluginTranslationV1Ast, PluginTranslationV1Regex } from '../../types';
import { AstTranslator } from './core-ast-translator';
import { RegexTranslator } from './core-regex-translator';
import { useGlobalStoreInstance } from '~/utils';

/**
 * 生成插件的翻译 JSON 对象。
 * @param pluginVersion - 插件的版本号。
 * @param manifestJSON - 插件的manifest.json对象。 
 * @param mainStr - 插件的主要字符串内容。
 * @param reLength - 正则表达式匹配的最大长度。
 * @param regexps - 用于匹配字符串的正则表达式数组。
 * @returns 一个包含翻译信息的 Translation 对象。
 */
export function generatePlugin(pluginVersion: string, manifestJSON: PluginManifest, mainStr: string, language: string, settings: any): PluginTranslationV1 {
    const translationJson: PluginTranslationV1 = {
        schemaVersion: PluginTranslationSchemaVersion.V1,
        metadata: {
            plugin: manifestJSON.id,
            version: '1.0.0',
            title: manifestJSON.name,
            description: `${manifestJSON.name} Localization & Tweaks`,
            language: language,
            supportedVersions: pluginVersion,
            author: settings.author || '',
        },
        dict: {
            'main.js': {
                ast: [],
                regex: []
            }
        }
    };
    // 生成AST字典
    const astTranslator = new AstTranslator(settings);
    const ast = astTranslator.loadCode(mainStr);
    if (ast) translationJson.dict['main.js'].ast = astTranslator.extract(ast);

    // 生成RE字典
    const regexTranslator = new RegexTranslator(settings);
    const regex = regexTranslator.loadCode(mainStr);
    if (regex) translationJson.dict['main.js'].regex = regex;

    return translationJson;
}

/**
 * 计算翻译数据的校验和 (SHA-256)
 * 计算时会将 checksum 字段排除在外 (如果存在)
 */
export function calculateChecksum(data: any): string {
    // 1. 深拷贝数据，防止修改原对象
    const content = JSON.parse(JSON.stringify(data));
    // 2. 移除不用作校验的字段
    if (content.checksum) delete content.checksum;
    // 3. 稳定序列化 (确保 Key 顺序一致)
    const stableString = stableStringify(content);
    // 4. 计算 SHA-256
    return createHash('sha256').update(stableString).digest('hex');
}

/**
 * 简单的稳定 JSON 序列化 (对 Key 进行排序)
 */
function stableStringify(obj: any): string {
    if (typeof obj !== 'object' || obj === null) {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return '[' + obj.map(stableStringify).join(',') + ']';
    }
    return '{' + Object.keys(obj).sort().map(key =>
        JSON.stringify(key) + ':' + stableStringify(obj[key])
    ).join(',') + '}';
}




/**
 * 生成主题的翻译 JSON 对象。
 * @param themeManifest - 主题的manifest.json对象。
 * @param themeStr - 主题的主要字符串内容。
 * @returns 一个包含翻译信息的 Theme 对象。
 */
export function generateTheme(themeManifest: OBThemeManifest, themeStr: string, settings: any): ThemeTranslationV1 {
    const themeJson: ThemeTranslationV1 = {
        schemaVersion: ThemeTranslationSchemaVersion.V1,
        metadata: {
            theme: themeManifest.name,
            language: 'zh-cn', // 默认语言
            version: '1.0.0',
            supportedVersions: themeManifest.version,
            title: themeManifest.name,
            description: `${themeManifest.name} Localization & Tweaks`,
            author: settings.author || '',
        },
        dict: []
    };
    // 使用全局匹配找到所有 /* @settings ... */ 注释块
    const settingsBlockRegex = /\/\* @settings([\s\S]*?)\*\//g;
    let blockMatch;
    const seenSources = new Set<string>();

    while ((blockMatch = settingsBlockRegex.exec(themeStr)) !== null) {
        const blockContent = blockMatch[1];

        // 匹配 YAML 字段：name, title, description, label, markdown
        // 捕获前缀、可能的引号、实际内容、可能的后引号
        const fieldRegex = /^(?:[ \t]*)(name|title|description|label|markdown):\s*(["']?)(.*?)\2[ \t]*(?:\r?\n|$)/gm;
        let fieldMatch;

        while ((fieldMatch = fieldRegex.exec(blockContent)) !== null) {
            const fieldType = fieldMatch[1];
            const pureText = fieldMatch[3];

            // 过滤空字符串并且排重
            if (pureText.trim() !== '' && !seenSources.has(pureText)) {
                seenSources.add(pureText);
                themeJson.dict.push({
                    type: fieldType,
                    source: pureText,
                    target: pureText
                });
            }
        }
    }

    return themeJson;
}

/**
 * 合并 AST 翻译项
 * @param existingItems 现有的 AST 翻译项 (由编辑器维护或从文件读取)
 * @param newItems 新提取的 AST 翻译项
 * @returns 合并后的 AST 翻译项
 */
export function mergeAstItems(existingItems: PluginTranslationV1Ast[], newItems: PluginTranslationV1Ast[]): PluginTranslationV1Ast[] {
    const mergedMap = new Map<string, PluginTranslationV1Ast>();

    // 1. 将现有项存入 Map，使用 type, name, source 作为唯一标识
    existingItems.forEach(item => {
        const key = `${item.type}|${item.name || ''}|${item.source}`;
        mergedMap.set(key, { ...item });
    });

    // 2. 遍历新项：不存在则新增，已存在则保留人工数据、刷新源码位置
    newItems.forEach(newItem => {
        const key = `${newItem.type}|${newItem.name || ''}|${newItem.source}`;
        const existing = mergedMap.get(key);
        if (!existing) {
            mergedMap.set(key, { ...newItem });
            return;
        }
        mergedMap.set(key, refreshSourceDerivedFields(existing, newItem));
    });

    return Array.from(mergedMap.values());
}

/**
 * 用新提取的值刷新旧条目「由源码推导」的字段，保留其余字段（译文、标记、AI 判定）。
 *
 * 不刷新时旧条目的 start/end 会永远停留在旧版本源码的坐标上，
 * 源码上下文预览只能退化成「按邻近位置定位」并提示位置可能不准。
 * 新提取值缺省（undefined）时保留旧值：宁可用旧坐标，也不要凭空抹掉位置信息。
 *
 * 逐字段显式赋值（而非遍历字段名）是为了保持类型安全：
 * 每个字段的赋值都由编译器校验，新增字段时不会静默漏刷。
 */
function refreshSourceDerivedFields(
    existing: PluginTranslationV1Ast,
    fresh: PluginTranslationV1Ast
): PluginTranslationV1Ast {
    const next: PluginTranslationV1Ast = { ...existing };
    if (fresh.start !== undefined) next.start = fresh.start;
    if (fresh.end !== undefined) next.end = fresh.end;
    if (fresh.line !== undefined) next.line = fresh.line;
    if (fresh.col !== undefined) next.col = fresh.col;
    if (fresh.propKey !== undefined) next.propKey = fresh.propKey;
    if (fresh.argIndex !== undefined) next.argIndex = fresh.argIndex;
    return next;
}

/**
 * 合并 Regex 翻译项
 * @param existingItems 现有的 Regex 翻译项
 * @param newItems 新提取的 Regex 翻译项
 * @returns 合并后的 Regex 翻译项
 */
export function mergeRegexItems(existingItems: PluginTranslationV1Regex[], newItems: PluginTranslationV1Regex[]): PluginTranslationV1Regex[] {
    const mergedMap = new Map<string, PluginTranslationV1Regex>();

    // 1. 将现有项存入 Map，使用 source 作为唯一标识
    existingItems.forEach(item => {
        mergedMap.set(item.source, { ...item });
    });

    // 2. 遍历新项，如果不存在则添加
    newItems.forEach(newItem => {
        if (!mergedMap.has(newItem.source)) {
            mergedMap.set(newItem.source, { ...newItem });
        }
    });

    return Array.from(mergedMap.values());
}