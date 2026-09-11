import { StateCreator } from 'zustand';
import { RegexStore, DictSlice, sourceCacheKey } from '../types';
import { PluginTranslationFileDict } from '@/src/types';
import { useGlobalStoreInstance } from '~/utils';
import { collectLearnable } from '~/utils/translator/translation-memory';

/**
 * AstItem → 持久化字典条目的序列化字段列表。
 * 集中定义避免多处复制导致新增字段漏同步。
 */
const toAstDictItem = (item: RegexStore['astItems'][number]) => ({
    type: item.type,
    name: item.name,
    source: item.source,
    target: item.target,
    start: item.start,
    end: item.end,
    line: item.line,
    col: item.col,
    propKey: item.propKey,
    argIndex: item.argIndex,
    aiVerdict: item.aiVerdict,
    aiReason: item.aiReason,
    aiConfidence: item.aiConfidence,
    ignored: item.ignored,
});

/**
 * AST 条目的标记 key，与 mergeAstItems 的唯一标识 (type|name|source) 保持一致。
 * 供「删除条目 → 重新提取」时按 key 恢复人工标记。
 */
export const astDictKey = (item: { type: string; name?: string; source: string }): string =>
    `${item.type}|${item.name || ''}|${item.source}`;

/**
 * 把当前译文沉淀进翻译记忆 (sidecar: translation-memory.json)。
 * 记忆按「插件 ID + 目标语言」分区（语言取 metadata.language，缺省退回全局设置），
 * 跨文件共享——任意一个文件的译文学习后，其他文件提取到相同条目也能复用。
 * 仅在设置开启且确实有可学习译文时写盘；异常只记日志，不阻断保存流程。
 */
const learnTranslationMemory = (
    metadata: { plugin?: string; language?: string } | null | undefined,
    astItems: readonly { type?: string; name?: string; source: string; target: string; ignored?: boolean }[],
    regexItems: readonly { source: string; target: string; ignored?: boolean }[],
): void => {
    try {
        const i18n = useGlobalStoreInstance.getState().i18n;
        if (!i18n?.translationMemory || i18n.settings.translationMemoryEnabled === false) return;
        if (!metadata?.plugin) return;

        const language = metadata.language || i18n.settings.language;
        if (!language) return;

        const entries = [
            ...collectLearnable(astItems),
            ...collectLearnable(regexItems),
        ];
        if (entries.length > 0) {
            i18n.translationMemory.upsertEntries(metadata.plugin, language, entries);
        }
    } catch (error) {
        console.error('[Editor] 学习翻译记忆失败:', error);
    }
};

/**
 * 把条目上的人工标记并回 per-file key 集合 (并集，不自减)。
 * 用于文件切换/保存时自愈：旧数据条目上的 ignored 无条件沉淀进集合，
 * 保证「删除条目 → 重新提取」时标记可恢复；「取消标记」走 applyIgnoredKeys 从集合移除。
 */
const mergeIgnoredKeys = (
    existing: PluginTranslationFileDict['ignoredKeys'],
    astItems: readonly { ignored?: boolean; type: string; name?: string; source: string }[],
    regexItems: readonly { ignored?: boolean; source: string }[],
): NonNullable<PluginTranslationFileDict['ignoredKeys']> => {
    const ast = new Set(existing?.ast ?? []);
    const regex = new Set(existing?.regex ?? []);
    for (const item of astItems) if (item.ignored) ast.add(astDictKey(item));
    for (const item of regexItems) if (item.ignored) regex.add(item.source);
    return { ast: Array.from(ast), regex: Array.from(regex) };
};

/**
 * 把标记变化同步到 sidecar 持久化 (ignored-keys.json)。
 * sidecar 是标记的权威来源——翻译源可被删除后全新提取，只有它活得比翻译源久。
 * 写失败只记日志：sidecar 是恢复通道，失败不该阻断编辑器内的标记操作。
 */
const persistIgnoredKeys = (
    pluginId: string | undefined,
    file: string,
    kind: 'ast' | 'regex',
    added: string[],
    removed: string[],
): void => {
    if (!pluginId || !file) return;
    try {
        useGlobalStoreInstance.getState().i18n?.sourceManager
            ?.upsertIgnoredKeys(pluginId, file, kind, added, removed);
    } catch (error) {
        console.error('[Editor] Failed to persist ignored keys:', error);
    }
};

/**
 * dict 条目 → store 条目：重分配 id，并按 ignoredKeys 集合回标人工标记。
 * 加载侧也必须回标：管理中心的主提取流程是全新生成条目后连集合一起落盘，
 * 集合是标记的权威来源，仅靠条目上的 ignored 恢复不了已删除的条目。
 */
const hydrateDictItems = (fileData: NonNullable<RegexStore['dictData'][string]>) => {
    const ignoredAst = new Set(fileData.ignoredKeys?.ast ?? []);
    const ignoredRegex = new Set(fileData.ignoredKeys?.regex ?? []);
    return {
        astItems: fileData.ast.map((item, index) => ({
            ...item,
            id: index,
            ignored: item.ignored || ignoredAst.has(astDictKey(item))
        })),
        regexItems: fileData.regex.map((item, index) => ({
            id: index,
            source: item.source,
            target: item.target,
            ignored: item.ignored || ignoredRegex.has(item.source)
        }))
    };
};

export const createDictSlice: StateCreator<
    RegexStore,
    [],
    [],
    DictSlice
> = (set, get) => ({
    dictData: {},
    currentFile: 'main.js',
    searchQuery: '',
    sourceCache: {},

    // 加载新的翻译源时一并清空源码缓存：上一个源/插件的源码不能参与新源的定位
    setDictData: (data) => set({ dictData: data, sourceCache: {} }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setSourceCache: (pluginId, file, code, origin) => set(state => ({
        sourceCache: {
            ...state.sourceCache,
            [sourceCacheKey(pluginId, file)]: {
                code,
                sourcePath: origin?.path ?? null,
                mtimeMs: origin?.fingerprint?.mtimeMs ?? null,
                size: origin?.fingerprint?.size ?? 0
            }
        }
    })),
    clearSourceCache: () => set({ sourceCache: {} }),

    setCurrentFile: (file) => {
        // 切换文件前，先把当前正在编辑的译文沉淀进翻译记忆
        const { metadata, astItems: editingAstItems, regexItems: editingRegexItems } = get();
        learnTranslationMemory(metadata, editingAstItems, editingRegexItems);

        set((state) => {
            const { currentFile, astItems, regexItems, dictData } = state;
            const newData = { ...dictData };

            // 1. 保存当前进度到原文件 (同时把条目上的标记沉淀进 ignoredKeys)
            if (currentFile && newData[currentFile]) {
                newData[currentFile] = {
                    ast: astItems.map(toAstDictItem),
                    regex: regexItems.map(item => ({ source: item.source, target: item.target, ignored: item.ignored })),
                    ignoredKeys: mergeIgnoredKeys(newData[currentFile].ignoredKeys, astItems, regexItems)
                };
            }

            // 2. 获取新文件内容 (加载侧同样回填：条目上的 ignored 并入 ignoredKeys)
            const prevFileData = newData[file];
            let nextFileData: NonNullable<RegexStore['dictData'][string]>;
            if (prevFileData) {
                nextFileData = {
                    ast: prevFileData.ast,
                    regex: prevFileData.regex,
                    ignoredKeys: mergeIgnoredKeys(prevFileData.ignoredKeys, prevFileData.ast, prevFileData.regex)
                };
                newData[file] = nextFileData;
            } else {
                nextFileData = { ast: [], regex: [] };
            }
            const { astItems: nextAstItems, regexItems: nextRegexItems } = hydrateDictItems(nextFileData);

            // 3. 一次性更新所有状态
            return {
                currentFile: file,
                dictData: newData,
                astItems: nextAstItems,
                regexItems: nextRegexItems
            };
        });
    },

    addFile: (file) => {
        const { dictData } = get();
        if (dictData[file]) return; // 如果已存在，不重复添加

        const newData = { ...dictData };
        newData[file] = { ast: [], regex: [] };

        set({ dictData: newData });
        // 自动切换到新添加的文件
        get().setCurrentFile(file);
    },

    deleteFile: (file) => {
        set((state) => {
            const { dictData, currentFile, astItems, regexItems, sourceCache, metadata } = state;
            if (!dictData[file]) return state;

            const newData = { ...dictData };

            // 1. 如果当前还有正在编辑的项目，先将其保存到 dictData 中对应的位置 (除了要删除的那个)
            if (currentFile && newData[currentFile] && currentFile !== file) {
                newData[currentFile] = {
                    ast: astItems.map(toAstDictItem),
                    regex: regexItems.map(item => ({ source: item.source, target: item.target, ignored: item.ignored })),
                    ignoredKeys: mergeIgnoredKeys(newData[currentFile].ignoredKeys, astItems, regexItems)
                };
            }

            // 2. 执行删除
            delete newData[file];

            // 3. 同时也从源码缓存中移除
            const newSourceCache = { ...sourceCache };
            delete newSourceCache[sourceCacheKey(metadata?.plugin ?? '', file)];

            let nextState: Partial<RegexStore> = {
                dictData: newData,
                sourceCache: newSourceCache
            };

            // 4. 如果删除的是当前正在编辑的文件，或者当前已空，强制重置/切换1
            if (currentFile === file) {
                const nextFile = newData['main.js'] ? 'main.js' : Object.keys(newData)[0] || '';
                if (nextFile) {
                    const nextFileData = newData[nextFile] || { ast: [], regex: [] };
                    const { astItems: nextAstItems, regexItems: nextRegexItems } = hydrateDictItems(nextFileData);
                    nextState = {
                        ...nextState,
                        currentFile: nextFile,
                        astItems: nextAstItems,
                        regexItems: nextRegexItems
                    };
                } else {
                    nextState = {
                        ...nextState,
                        currentFile: '',
                        astItems: [],
                        regexItems: []
                    };
                }
            }
            return nextState;
        });
    },

    syncFileDictInfo: (file, newAstItems, newRegexItems) => {
        // 保存前把有效译文沉淀进翻译记忆（增量提取回填的译文也会随保存固化）
        const { metadata } = get();
        learnTranslationMemory(metadata, newAstItems, newRegexItems);

        set((state) => {
            const newData = { ...state.dictData };
            newData[file] = {
                ast: newAstItems.map(toAstDictItem),
                regex: newRegexItems.map(item => ({ source: item.source, target: item.target, ignored: item.ignored })),
                // 保存前同步：条目上的标记沉淀进集合 (并集)，保证跨删除/重新提取持久
                ignoredKeys: mergeIgnoredKeys(state.dictData[file]?.ignoredKeys, newAstItems, newRegexItems)
            };
            return { dictData: newData };
        });
    },

    applyIgnoredKeys: (kind, added, removed) => {
        if (added.length === 0 && removed.length === 0) return;
        set((state) => {
            const file = state.currentFile;
            const entry = state.dictData[file];
            if (!entry) return state;

            const keys = new Set(entry.ignoredKeys?.[kind] ?? []);
            for (const key of added) keys.add(key);
            for (const key of removed) keys.delete(key);
            const nextKeys = { ...entry.ignoredKeys, [kind]: Array.from(keys) };

            // 同步到 sidecar：删除翻译源后重新提取，靠它恢复标记
            persistIgnoredKeys(state.metadata?.plugin, file, kind, added, removed);

            return {
                dictData: {
                    ...state.dictData,
                    [file]: {
                        ...entry,
                        ignoredKeys: nextKeys
                    }
                }
            };
        });
    }
});
