/**
 * 文件名称: pending-items.ts
 * 模块描述: 「待翻译条目」的筛选口径 (AST / Regex 共用)
 *
 * 存在的理由:
 *   AST 与 Regex 两侧各有一份 `targetItems` 过滤逻辑，且已经漂移过两次——
 *   「不需要翻译 (ignored)」两侧都漏，另一条额外条件只加在单侧。
 *   统一到此处后，新增过滤条件只需改一个地方，也便于单测覆盖边界。
 *
 * 注意事项:
 *   - 纯函数，不依赖 obsidian / React，便于 vitest 直接覆盖
 *   - 只回答「哪些条目该翻」，不做排序与去重 (调用方负责)
 */

/** 待翻译条目的最小结构 */
export interface PendingItemLike {
    source: string;
    target?: string;
    ignored?: boolean;
}

export interface SelectPendingItemsOptions {
    /** 覆盖模式：连同已有译文一并重翻 */
    overwrite?: boolean;
}

/**
 * 选出本次批量翻译要处理的条目
 *
 * 过滤条件 (按优先级):
 *   1. 人工标记「不需要翻译」的条目永远跳过——覆盖模式也不能推翻人工结论
 *   2. 其余按「未翻译」判定；overwrite 为真时全部纳入
 *
 * 需要「只翻其中一部分」时由调用方在结果上再做白名单过滤（如正则表格的多选），
 * 本函数只回答「哪些条目本身是待翻译的」。
 */
export function selectPendingItems<T extends PendingItemLike>(
    items: readonly T[],
    options: SelectPendingItemsOptions = {}
): T[] {
    const { overwrite = false } = options;
    return items.filter(item => {
        if (item.ignored === true) return false;
        if (overwrite) return true;
        return !item.target || item.target.trim() === '' || item.target === item.source;
    });
}
