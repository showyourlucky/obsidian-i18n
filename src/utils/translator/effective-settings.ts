/**
 * 插件专属提取规则的合并入口。
 *
 * 单一出口原则：提取、注入、诊断等所有 AstTranslator / RegexTranslator 构造点
 * 都必须经由 buildEffectiveSettings 得到 settings 快照——提取与注入口径不一致
 * 会出现「列表里有条目、应用翻译时替换不上」的假翻译。
 *
 * 合并语义是【并集追加】而非替换：插件级规则只做增量，
 * 清空插件级字段即自然回落到全局规则，不产生「忘记抄全局默认值」的坑。
 */
import type { I18nSettings } from '../../settings/data';
import type { PluginExtractRules, PluginExtractRuleCall } from '../../types';
import { REGEX_DEFAULT_CONFIG } from './config';

/** 数组去重并集（保持先全局后插件级的顺序） */
const union = <T>(base: T[] | undefined, extra: T[] | undefined): T[] | undefined => {
    if (!extra || extra.length === 0) return base;
    const merged = [...(base ?? []), ...extra];
    return Array.from(new Set(merged));
};

/** 这些字段在翻译器中以“空数组 = 使用默认值”为语义，追加插件规则前需先展开默认值 */
const withDefaults = <T>(base: T[] | undefined, defaults: T[]): T[] =>
    base && base.length > 0 ? base : defaults;

/** callRules 按 fn + args 序列化去重（数组去重需按内容比较） */
const unionCallRules = (
    base: PluginExtractRuleCall[] | undefined,
    extra: PluginExtractRuleCall[] | undefined,
): PluginExtractRuleCall[] | undefined => {
    if (!extra || extra.length === 0) return base;
    const keyOf = (r: PluginExtractRuleCall) =>
        `${r.fn}(${(r.args ?? [0]).join(',')})`;
    const map = new Map<string, PluginExtractRuleCall>();
    for (const r of [...(base ?? []), ...extra]) map.set(keyOf(r), r);
    return Array.from(map.values());
};

export const buildEffectiveSettings = (
    base: I18nSettings,
    pluginRules: PluginExtractRules | null | undefined,
): I18nSettings => {
    if (!pluginRules) return base;

    const merged: any = { ...base };
    const ast = pluginRules.ast ?? {};
    const regex = pluginRules.regex ?? {};

    // AST 白名单类：并集
    merged.astKeys = union(base.astKeys, ast.keys);
    merged.astAssignments = union(base.astAssignments, ast.assignments);
    merged.astFunctions = union(base.astFunctions, ast.functions);
    merged.astOptionContainerKeys = union(base.astOptionContainerKeys, ast.optionContainers);
    merged.astCallRules = unionCallRules(base.astCallRules, ast.callRules);
    merged.astNonTranslatableProps = union(base.astNonTranslatableProps, ast.nonTranslatableProps);
    merged.astTranslatableProps = union(base.astTranslatableProps, ast.translatableProps);

    // 内容过滤正则：并集（reject 追加排除、valid 追加放行特征）
    merged.astRejectRe = union(base.astRejectRe, ast.rejectRe);
    merged.astValidRe = union(withDefaults(base.astValidRe, REGEX_DEFAULT_CONFIG.validPatterns), ast.validRe);

    // Regex 规则：并集
    merged.reDatas = union(withDefaults(base.reDatas, REGEX_DEFAULT_CONFIG.patterns), regex.patterns);
    merged.reRejectRe = union(base.reRejectRe, regex.rejectRe);
    merged.reValidRe = union(withDefaults(base.reValidRe, REGEX_DEFAULT_CONFIG.validPatterns), regex.validRe);

    return merged as I18nSettings;
};
