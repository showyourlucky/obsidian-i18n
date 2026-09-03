import { StateCreator } from 'zustand';
import { RegexStore, AstSlice, AstItem } from '../types';
import { astDictKey } from './dict-slice';

export const createAstSlice: StateCreator<RegexStore, [], [], AstSlice> = (set, get) => ({
    astItems: [],

    setAstItems: (items: AstItem[]) => set({ astItems: items }),

    addAstItem: (newItem: AstItem) => set((state) => {
        const nextId = state.astItems.length > 0 ? Math.max(...state.astItems.map(item => item.id)) + 1 : 0;
        return {
            astItems: [...state.astItems, { ...newItem, id: nextId }]
        };
    }),

    updateAstItem: (id: number, target: string) => set((state) => ({
        astItems: state.astItems.map(item =>
            item.id === id ? { ...item, target } : item
        ),
    })),

    deleteAstItem: (id: number) => set((state) => ({
        astItems: state.astItems.filter(item => item.id !== id),
    })),

    resetAstItem: (id: number) => set((state) => ({
        astItems: state.astItems.map(item =>
            item.id === id ? { ...item, target: item.source } : item
        ),
    })),

    updateAstItems: (items) => {
        // 人工标记变化需同步到 per-file key 集合：
        // 条目随后可能被删除，重新提取时靠集合恢复标记（取消标记则同步移除，避免重提取又被标回）。
        // 在 set 之外同步：set 的 updater 里嵌套 set 依赖 zustand 的合并顺序，脆弱且难排查。
        const byId = new Map(get().astItems.map(item => [item.id, item]));
        const added: string[] = [];
        const removed: string[] = [];
        for (const { id, updates } of items) {
            if (updates.ignored === undefined) continue;
            const item = byId.get(id);
            if (!item) continue;
            (updates.ignored ? added : removed).push(astDictKey(item));
        }
        if (added.length > 0 || removed.length > 0) {
            get().applyIgnoredKeys('ast', added, removed);
        }

        set((state) => {
            const updatesMap = new Map(items.map(i => [i.id, i.updates]));
            return {
                astItems: state.astItems.map(item => {
                    const updates = updatesMap.get(item.id);
                    return updates ? { ...item, ...updates } : item;
                })
            };
        });
    },

    // 「不需要翻译」为人工软标记（可能标错），清除未翻译时必须保留，由用户在「只看待删」中显式处理
    deleteUntranslatedAstItems: () => set((state) => ({
        astItems: state.astItems.filter(item =>
            item.ignored || (item.target && item.target !== item.source && item.target.trim() !== '')
        )
    })),

    deleteAstItemsByIds: (ids: number[]) => set((state) => {
        const idSet = new Set(ids);
        const remaining = state.astItems.filter(item => !idSet.has(item.id));
        // 重新分配 ID 保证连续性
        return { astItems: remaining.map((item, index) => ({ ...item, id: index })) };
    }),

    resetAstItemsByIds: (ids: number[]) => set((state) => {
        const idSet = new Set(ids);
        return {
            astItems: state.astItems.map(item =>
                idSet.has(item.id) ? { ...item, target: item.source } : item
            ),
        };
    }),
});
