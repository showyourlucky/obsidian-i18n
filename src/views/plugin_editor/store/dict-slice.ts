import { StateCreator } from 'zustand';
import { RegexStore, DictSlice } from '../types';

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
});

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

    setDictData: (data) => set({ dictData: data }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setSourceCache: (file, code, fingerprint) => set(state => ({
        sourceCache: {
            ...state.sourceCache,
            [file]: {
                code,
                mtimeMs: fingerprint?.mtimeMs ?? null,
                size: fingerprint?.size ?? 0
            }
        }
    })),

    setCurrentFile: (file) => {
        set((state) => {
            const { currentFile, astItems, regexItems, dictData } = state;
            const newData = { ...dictData };

            // 1. 保存当前进度到原文件
            if (currentFile && newData[currentFile]) {
                newData[currentFile] = {
                    ast: astItems.map(toAstDictItem),
                    regex: regexItems.map(item => ({ source: item.source, target: item.target }))
                };
            }

            // 2. 获取新文件内容
            const nextFileData = newData[file] || { ast: [], regex: [] };
            const nextAstItems = nextFileData.ast.map((item, index) => ({ ...item, id: index }));
            const nextRegexItems = nextFileData.regex.map((item, index) => ({
                id: index,
                source: item.source,
                target: item.target
            }));

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
            const { dictData, currentFile, astItems, regexItems, sourceCache } = state;
            if (!dictData[file]) return state;

            const newData = { ...dictData };

            // 1. 如果当前还有正在编辑的项目，先将其保存到 dictData 中对应的位置 (除了要删除的那个)
            if (currentFile && newData[currentFile] && currentFile !== file) {
                newData[currentFile] = {
                    ast: astItems.map(toAstDictItem),
                    regex: regexItems.map(item => ({ source: item.source, target: item.target }))
                };
            }

            // 2. 执行删除
            delete newData[file];

            // 3. 同时也从源码缓存中移除
            const newSourceCache = { ...sourceCache };
            delete newSourceCache[file];

            let nextState: Partial<RegexStore> = {
                dictData: newData,
                sourceCache: newSourceCache
            };

            // 4. 如果删除的是当前正在编辑的文件，或者当前已空，强制重置/切换1
            if (currentFile === file) {
                const nextFile = newData['main.js'] ? 'main.js' : Object.keys(newData)[0] || '';
                if (nextFile) {
                    const nextFileData = newData[nextFile] || { ast: [], regex: [] };
                    nextState = {
                        ...nextState,
                        currentFile: nextFile,
                        astItems: nextFileData.ast.map((item, index) => ({ ...item, id: index })),
                        regexItems: nextFileData.regex.map((item, index) => ({
                            id: index,
                            source: item.source,
                            target: item.target
                        }))
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
        set((state) => {
            const newData = { ...state.dictData };
            newData[file] = {
                ast: newAstItems.map(toAstDictItem),
                regex: newRegexItems.map(item => ({ source: item.source, target: item.target }))
            };
            return { dictData: newData };
        });
    }
});
