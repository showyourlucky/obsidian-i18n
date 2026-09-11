/**
 * 文件名称: migrations.ts
 * 模块描述: 设置项的一次性历史迁移 (启动时执行，幂等)
 *
 * 存在的理由:
 *   设置是「持久化覆盖」语义 —— main.ts 的 loadSettings 用
 *   Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) 合并，
 *   而提取器优先读取 settings 中的值 (见 core-ast-translator / core-regex-translator
 *   的 initPatterns)。因此 data.json 里一旦写入过出厂默认规则的副本，后续修改
 *   config.ts 的默认常量对已安装用户就完全不生效。默认规则的缺陷修复必须在此显式升级。
 *
 * 注意事项:
 *   - 只做「定向修复」，绝不整体覆盖用户自定义规则
 *   - 必须幂等：升级后的值不再命中任何修复条件，重复执行不会有副作用
 */

import { ELLIPSIS_TAIL_RULE, REGEX_DEFAULT_CONFIG } from '../utils/translator/config';
// 仅类型依赖：避免运行时把 data.ts (及其 obsidian 依赖链) 一并拉起，便于单测直接覆盖
import type { I18nSettings } from './data';

/**
 * 历史默认正则里的缺陷字符类 → 修正值
 *
 * 均为正则字符串内部的子串替换，键值是 pattern 字符串里的原始片段。
 * 旧默认写成 `[^\\2\\\\]` (即 `[^\\\\2\\\\\\\\]`)，解码后同时排除了
 * 反斜杠与数字 2，导致含 2 的候选文案被静默漏掉。
 */
const CHAR_CLASS_FIXES: Array<[string, string]> = [
    // 出厂默认形态: 排除反斜杠 + 数字 2 + 多个反斜杠
    ['[^\\\\2\\\\\\\\]', '[^\\\\]'],
    // 用户抄写该缺陷时可能留下的简化形态
    ['[^\\\\2]', '[^\\\\]']
];

/**
 * 历史默认的有效特征规则快照 (缺少省略号句末标点)
 *
 * 必须写成字面量，不能从 REGEX_DEFAULT_CONFIG 推算：
 * 迁移要判断的是「用户当初存了什么」，一旦这里跟随最新默认漂移，
 * 未来任何一次默认值修改 (如给标点类补字符) 都会让老用户的升级条件失配，
 * 其结果不是报错而是静默跳过升级，极难排查。
 */
const LEGACY_VALID_PATTERNS: string[] = [
    '\\s',
    '[^\\x00-\\x7F]',
    '[!?,;:。！？，；：]\\s*$'
];

/** 逐项值比较 */
function isSameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 修复正则字符串中被误排除的数字 2 */
function fixLegacyCharClass(pattern: string): string {
    let fixed = pattern;
    for (const [from, to] of CHAR_CLASS_FIXES) fixed = fixed.split(from).join(to);
    return fixed;
}

/**
 * 升级有效特征规则
 *
 * 仅当当前值仍「逐项等于历史默认」时才替换为最新默认；
 * 用户自行增删过规则时保持原样 —— 默认规则的升级不能覆盖人工配置。
 */
function upgradeValidPatterns(current: string[], latest: readonly string[]): string[] {
    // 空列表 = 走内置默认，天然跟随最新规则
    if (!Array.isArray(current) || current.length === 0) return current;
    // 已含省略号规则，说明升级过
    if (current.includes(ELLIPSIS_TAIL_RULE)) return current;
    // 与历史默认不一致 = 用户自定义，不碰
    if (!isSameList(current, LEGACY_VALID_PATTERNS)) return current;
    return [...latest];
}

/**
 * 就地迁移设置对象
 *
 * @returns 是否发生变更 (调用方据此决定是否落盘)
 */
export function migrateSettings(settings: I18nSettings): boolean {
    if (!settings) return false;
    let changed = false;

    // 1. 修复核心匹配正则里把「数字 2」一并排除的缺陷字符类
    if (Array.isArray(settings.reDatas) && settings.reDatas.length > 0) {
        const fixed = settings.reDatas.map(fixLegacyCharClass);
        if (fixed.some((p, i) => p !== settings.reDatas[i])) {
            settings.reDatas = fixed;
            changed = true;
        }
    }

    // 2. 补齐省略号句末标点规则 (Regex 侧与 AST 侧同源，两侧都要升)
    const reValid = upgradeValidPatterns(settings.reValidRe, REGEX_DEFAULT_CONFIG.validPatterns);
    if (reValid !== settings.reValidRe) {
        settings.reValidRe = reValid;
        changed = true;
    }

    const astValid = upgradeValidPatterns(settings.astValidRe, REGEX_DEFAULT_CONFIG.validPatterns);
    if (astValid !== settings.astValidRe) {
        settings.astValidRe = astValid;
        changed = true;
    }

    return changed;
}
