import { StateCreator } from 'zustand';
import { PluginTranslationV1Regex } from '@/src/types';
import { RegexItem, RegexStore, RegexSlice } from '../types';

export const createRegexSlice: StateCreator<RegexStore, [], [], RegexSlice> = (set, get) => {
    /**
     * ignored 标记变化同步到当前文件的 ignoredKeys 集合（跨删除/重新提取持久）：
     * 条目随后可能被删除，重新提取时靠集合恢复标记；取消标记则同步移除，避免重提取又被标回。
     *
     * 入参是扁平的 { id, ignored } 变更列表（调用方负责从 `{id, updates}` 里取出 ignored），
     * 且必须在 set 之外调用：在 set 的 updater 里嵌套 set 依赖 zustand 的合并顺序，脆弱且难排查。
     */
    const syncIgnoredChange = (changes: { id: number; ignored?: boolean }[]) => {
        const byId = new Map(get().regexItems.map(item => [item.id, item]));
        const added: string[] = [];
        const removed: string[] = [];
        for (const { id, ignored } of changes) {
            if (ignored === undefined) continue;
            const item = byId.get(id);
            if (!item) continue;
            (ignored ? added : removed).push(item.source);
        }
        if (added.length > 0 || removed.length > 0) {
            get().applyIgnoredKeys('regex', added, removed);
        }
    };

    return {
        regexItems: [],

        setRegexItems: (items: RegexItem[]) => {
            set({ regexItems: items });
        },

        addRegexItem: (newItem: RegexItem) => {
            set((state) => {
                const nextId = state.regexItems.length > 0 ? Math.max(...state.regexItems.map(item => item.id)) + 1 : 0;
                return {
                    regexItems: [...state.regexItems, { ...newItem, id: nextId }]
                };
            });
        },

        updateRegexItem: (id: number, updates: Partial<PluginTranslationV1Regex>) => {
            // 用 set 之前的快照定位 source（不依赖更新结果）
            if (updates.ignored !== undefined) {
                syncIgnoredChange([{ id, ignored: updates.ignored }]);
            }
            set((state) => ({
                regexItems: state.regexItems.map(item =>
                    item.id === id ? { ...item, ...updates } : item
                ),
            }));
        },

        updateRegexItems: (items) => {
            syncIgnoredChange(items.map(i => ({ id: i.id, ignored: i.updates.ignored })));
            set((state) => {
                const updatesMap = new Map(items.map(i => [i.id, i.updates]));
                return {
                    regexItems: state.regexItems.map(item => {
                        const updates = updatesMap.get(item.id);
                        return updates ? { ...item, ...updates } : item;
                    })
                };
            });
        },

        deleteRegexItem: (id: number) => {
            set((state) => ({
                regexItems: state.regexItems.filter(item => item.id !== id),
            }));
        },

        resetRegexItem: (id: number) => {
            set((state) => ({
                regexItems: state.regexItems.map(item =>
                    item.id === id ? { ...item, target: item.source } : item
                ),
            }));
        },

        // 「不需要翻译」为人工软标记（可能标错），清除未翻译时必须保留，由用户在「只看待删」中显式处理
        deleteUntranslatedRegexItems: () => set((state) => ({
            regexItems: state.regexItems.filter(item =>
                item.ignored || (item.target && item.target !== item.source && item.target.trim() !== '')
            )
        })),
    };
};
