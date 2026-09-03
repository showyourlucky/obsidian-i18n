/**
 * 文件名称: translation-memory.ts
 * 模块描述: 翻译记忆管理器 (扁平化 sidecar 结构)
 * 核心功能:
 *   - 加载 / 保存 translation-memory.json（插件 ID → 目标语言 → 记忆键 → 记忆条目）
 *   - 按插件 + 语言查询记忆、批量写入记忆、清空记忆
 *   - 容量保护：超出上限时按 updatedAt 淘汰最旧条目
 *
 * 开发人员: zero
 * 维护人员: zero
 * 创建日期: 2026-09-04
 *
 * 注意事项:
 *   - 记忆的生命周期独立于翻译源：翻译源删除并重新提取后，记忆依然可复用
 *   - 仅在内容确有变化时写盘：编辑器 500ms 防抖的自动保存会频繁触发学习入口，
 *     无变化就不落盘，避免反复重写数 MB 的 JSON
 *   - 读写异常只记录日志并降级为「无记忆可用」，绝不阻断提取与保存流程
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
    TranslationMemoryEntry,
    TranslationMemoryStore,
    EMPTY_TRANSLATION_MEMORY,
} from '../types';
import { MAX_ENTRIES_PER_LANG } from '../utils/translator/translation-memory';

export class TranslationMemoryManager {
    private basePath: string;        // i18n 插件目录
    private memoryPath: string;      // translation-memory.json 路径
    private memory: TranslationMemoryStore;

    constructor(i18nPluginDir: string) {
        this.basePath = i18nPluginDir;
        this.memoryPath = path.join(i18nPluginDir, 'translation-memory.json');
        this.memory = this.loadMemoryStore();
    }

    // ========== 加载与保存 ==========

    /**
     * 加载记忆存储。文件缺失或内容损坏时降级为空存储，不抛异常——
     * 记忆是加速手段，加载失败不该让插件或编辑器不可用。
     */
    private loadMemoryStore(): TranslationMemoryStore {
        try {
            if (fs.existsSync(this.memoryPath)) {
                const raw = fs.readJsonSync(this.memoryPath);
                // 校验 version：未来 v2 结构无法识别时降级为空，而不是错误解读
                if (raw?.version === 1 && raw?.plugins && typeof raw.plugins === 'object') {
                    return { version: 1, plugins: raw.plugins };
                }
            }
        } catch (error) {
            console.error('[TranslationMemory] 加载翻译记忆失败，本次将以空记忆运行:', error);
        }
        return JSON.parse(JSON.stringify(EMPTY_TRANSLATION_MEMORY));
    }

    private saveMemoryStore(): void {
        try {
            fs.ensureDirSync(this.basePath);
            fs.writeJsonSync(this.memoryPath, this.memory, { spaces: 2 });
        } catch (error) {
            console.error('[TranslationMemory] 保存翻译记忆失败:', error);
        }
    }

    // ========== 基础查询 ==========

    /**
     * 读取某插件某语言的全部记忆（记忆键 → 条目）。
     * 记忆键由纯逻辑层生成，调用方无需感知其派生规则。
     */
    public getPluginMemory(pluginId: string, language: string): Record<string, TranslationMemoryEntry> {
        if (!pluginId || !language) return {};
        return this.memory.plugins[pluginId]?.[language] ?? {};
    }

    // ========== 写入 ==========

    /**
     * 批量写入记忆条目（同键覆盖，刷新 updatedAt）。
     * @returns 实际新增 / 更新的条数；为 0 表示内容无变化（此时既不淘汰也不落盘），
     *          发生容量淘汰时必然返回 >0。
     */
    public upsertEntries(
        pluginId: string,
        language: string,
        entries: Array<{ key: string; type: string; name: string; target: string; preview: string }>,
    ): number {
        if (!pluginId || !language || !entries || entries.length === 0) return 0;

        const now = Date.now();
        const plugins = { ...this.memory.plugins };
        const byLanguage = { ...(plugins[pluginId] ?? {}) };
        const byKey: Record<string, TranslationMemoryEntry> = { ...(byLanguage[language] ?? {}) };

        let changed = 0;
        for (const entry of entries) {
            const existing = byKey[entry.key];
            // 变更判定只看「译文 + 上下文」，不含 preview：preview 仅供人工排查，
            // 若参与判定，同键但原文空白不同的条目交替保存会造成无意义的反复写盘
            if (existing && existing.target === entry.target && existing.type === entry.type && existing.name === entry.name) {
                continue;
            }
            byKey[entry.key] = {
                type: entry.type,
                name: entry.name,
                target: entry.target,
                preview: entry.preview,
                updatedAt: now,
            };
            changed++;
        }

        if (changed === 0) return 0;

        const evicted = this.evictOverflow(byKey);
        byLanguage[language] = byKey;
        plugins[pluginId] = byLanguage;
        this.memory = { version: 1, plugins };

        this.saveMemoryStore();
        return changed + evicted;
    }

    /**
     * 容量保护：超出上限时按 updatedAt 淘汰最旧条目。
     * 上限取得较宽 (20000)，避免它先于「保存全部译文」这个首要目标生效。
     */
    private evictOverflow(byKey: Record<string, TranslationMemoryEntry>): number {
        const keys = Object.keys(byKey);
        if (keys.length <= MAX_ENTRIES_PER_LANG) return 0;

        const ordered = keys.sort((a, b) => (byKey[a].updatedAt ?? 0) - (byKey[b].updatedAt ?? 0));
        const overflow = keys.length - MAX_ENTRIES_PER_LANG;
        for (let i = 0; i < overflow; i++) {
            delete byKey[ordered[i]];
        }
        return overflow;
    }

    // ========== 清理 ==========

    /**
     * 清空指定插件的记忆；传入 language 时只清该语言。
     * 删除翻译源不会自动调用：删源 ≠ 译文知识作废。
     */
    public clearMemory(pluginId: string, language?: string): void {
        if (!pluginId) return;

        const plugins = { ...this.memory.plugins };
        if (!plugins[pluginId]) return;

        if (language) {
            const byLanguage = { ...plugins[pluginId] };
            delete byLanguage[language];
            if (Object.keys(byLanguage).length === 0) {
                delete plugins[pluginId];
            } else {
                plugins[pluginId] = byLanguage;
            }
        } else {
            delete plugins[pluginId];
        }

        this.memory = { version: 1, plugins };
        this.saveMemoryStore();
    }
}
