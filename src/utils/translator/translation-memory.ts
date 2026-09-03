/**
 * 文件名称: translation-memory.ts
 * 模块描述: 翻译记忆 (Translation Memory) 的纯逻辑层
 * 核心功能:
 *   - 原文归一化：剔除零宽字符、全角转半角、折叠连续空白，供精确匹配使用
 *   - 定长记忆键：由 `type|name|source` 上下文派生 sha256 前 32 位，长原文不撑爆键
 *   - 可学习判定：过滤空译文 / 未翻译 / 已标记「不需要翻译」的条目
 *   - 记忆应用：仅把历史译文回填到当前无译文的条目，并标记 tmHit 供 UI 展示
 *
 * 开发人员: zero
 * 维护人员: zero
 * 创建日期: 2026-09-04
 *
 * 修改日期:
 *   - 2026-09-04 [v1.0.0] zero: 初始版本，实现基础功能;
 *
 * 注意事项:
 *   - 本层不依赖 obsidian / fs，便于 vitest 直接覆盖全部边界
 *   - 归一化不做大小写折叠：Add 与 add 在 UI 文案中可能是不同含义，折叠会造成误翻
 *   - 不做长度过滤：长原文 (SVG / 模板字符串) 是重复提取时最耗时、最需要复用的部分
 */

import { createHash } from 'crypto';
import type { TranslationMemoryEntry } from '../../types';

/** 记忆键长度：sha256 hex 前 32 位，128 bit，条目量级下碰撞概率可忽略 */
export const MEMORY_KEY_LENGTH = 32;

/** 原文预览截断长度（仅供人工排查记忆内容，不参与匹配） */
export const PREVIEW_LENGTH = 80;

/** 每插件每语言的记忆容量上限，超出按 updatedAt 淘汰最旧 */
export const MAX_ENTRIES_PER_LANG = 20000;

/**
 * 上下文拼接分隔符：ASCII 单元分隔符。
 * 不用 '|' 是因为属性键本身可以包含 '|' (如 { 'a|b': 'x' })，
 * 用 '|' 拼接会让 name 与 source 的边界产生歧义，进而生成错位记忆键。
 */
const CONTEXT_SEPARATOR = '\u001F';

/** 零宽字符：肉眼不可见却会让两条看似相同的原文匹配不上 */
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;

/** 全角 ASCII 区间 (!-~) 与全角空格 */
const FULLWIDTH_ASCII_PATTERN = /[\uFF01-\uFF5E]/g;
const FULLWIDTH_SPACE_PATTERN = /\u3000/g;

/**
 * 归一化原文：去零宽字符 → 全角转半角 → 折叠连续空白 → 去首尾空白。
 * 目的是让「看起来一样但字节不同」的原文能命中同一条记忆。
 */
export function normalizeSource(source: string): string {
    if (!source) return '';
    return source
        .replace(ZERO_WIDTH_PATTERN, '')
        .replace(FULLWIDTH_ASCII_PATTERN, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(FULLWIDTH_SPACE_PATTERN, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 生成定长记忆键。
 * AST 条目传 type / name；Regex 条目没有上下文，两者均缺省为空串，
 * 因此 AST 与 Regex 的记忆天然分区，互不串用。
 */
export function buildMemoryKey(item: { type?: string; name?: string; source: string }): string {
    const raw = `${item.type ?? ''}${CONTEXT_SEPARATOR}${item.name ?? ''}${CONTEXT_SEPARATOR}${normalizeSource(item.source)}`;
    return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, MEMORY_KEY_LENGTH);
}

/** 条目是否已有有效译文（回填判定用：已有译文的条目绝不能被记忆覆盖） */
export function hasTranslation(item: { source: string; target: string }): boolean {
    const target = item.target ?? '';
    if (target.trim() === '') return false;
    return normalizeSource(target) !== normalizeSource(item.source ?? '');
}

/**
 * 译文是否可以入记忆：非空、归一化后不等于原文、未被标记「不需要翻译」。
 * 不做长度过滤——长条目的译文同样要保存，那正是重复提取时最想复用的部分。
 */
export function isLearnableTranslation(item: { source: string; target: string; ignored?: boolean }): boolean {
    if (item.ignored === true) return false;
    return hasTranslation(item);
}

/** 构建 记忆键 → 译文 的查找表（条目译文为空时跳过，避免把空串回填出去） */
export function buildMemoryIndex(
    entries: Record<string, TranslationMemoryEntry>,
): Map<string, string> {
    const index = new Map<string, string>();
    for (const [key, entry] of Object.entries(entries ?? {})) {
        if (!entry || typeof entry.target !== 'string' || entry.target === '') continue;
        index.set(key, entry.target);
    }
    return index;
}

/**
 * 把记忆中的译文回填到条目上。
 * 只处理当前无译文且未被标记「不需要翻译」的条目，命中后写入 target 并置 tmHit。
 * @param options.mark 设为 false 时不打 tmHit 标记——用于结果要直接落盘翻译源的调用方
 *                    （管理中心全新提取），运行时标记绝不能写进翻译源文件。
 * @returns 新数组与命中条数（命中条数用于提取完成后的提示）
 */
export function applyTranslationMemory<T extends {
    source: string;
    target: string;
    type?: string;
    name?: string;
    ignored?: boolean;
    tmHit?: boolean;
}>(items: readonly T[], index: Map<string, string>, options?: { mark?: boolean }): { items: T[]; hitCount: number } {
    if (!index || index.size === 0 || !items || items.length === 0) {
        // 无记忆可用：原样返回（保持引用不变，调用方零成本），断言仅放宽 readonly
        return { items: items as T[], hitCount: 0 };
    }

    const mark = options?.mark !== false;
    let hitCount = 0;
    const next = items.map((item) => {
        // 已有人工译文或未翻译标记的条目保持原样，记忆只做「填空」
        if (item.ignored === true || hasTranslation(item)) return item;

        const target = index.get(buildMemoryKey(item));
        if (target === undefined) return item;

        hitCount++;
        return mark ? { ...item, target, tmHit: true } : { ...item, target };
    });

    return { items: next, hitCount };
}

/** 原文预览：截断长原文，避免记忆文件里塞入整段模板/SVG 的副本 */
export function toPreview(source: string): string {
    if (!source) return '';
    return source.length > PREVIEW_LENGTH ? source.slice(0, PREVIEW_LENGTH) : source;
}

/**
 * 收集可写入记忆的条目。
 * 同一批次内记忆键相同的条目只保留最后一个（后写入覆盖先写入，与持久化层覆盖语义一致）。
 */
export function collectLearnable<T extends {
    source: string;
    target: string;
    type?: string;
    name?: string;
    ignored?: boolean;
}>(items: readonly T[]): Array<{ key: string; type: string; name: string; target: string; preview: string }> {
    const collected = new Map<string, { key: string; type: string; name: string; target: string; preview: string }>();

    for (const item of items ?? []) {
        if (!isLearnableTranslation(item)) continue;
        const key = buildMemoryKey(item);
        collected.set(key, {
            key,
            type: item.type ?? '',
            name: item.name ?? '',
            target: item.target,
            preview: toPreview(item.source)
        });
    }

    return Array.from(collected.values());
}
