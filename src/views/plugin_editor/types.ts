import I18N from "@/main";
import { ReactView } from "~/utils";
import { PluginTranslationV1, PluginTranslationV1Regex, PluginTranslationV1Metadata, PluginTranslationV1Ast, PluginTranslationFileDict, AiVerdict } from "@/src/types";

// 基础类型定义 ====================================================================================================
export interface EditorProps {
    reactView?: ReactView;
    title: string;
    translationJson: PluginTranslationV1;
    i18n: I18N;
}

export interface RegexItem {
    id: number;
    source: string;
    target: string;
    /** 人工标记：确认"不需要翻译"，与 AI 判定分离 */
    ignored?: boolean;
    /** 运行时标记：译文由翻译记忆自动回填（不落盘，重新加载后消失） */
    tmHit?: boolean;
}

export interface AstItem {
    id: number;
    type: string;
    name: string;
    source: string;
    target: string;
    // 源码位置与结构信号 (提取阶段写入，旧文件缺省 undefined)
    start?: number;     // 字符偏移 (Babel node.start)
    end?: number;       // 字符偏移 (Babel node.end)
    line?: number;      // 源码行号 (1-based)，缺省 0
    col?: number;       // 列号，缺省 0
    propKey?: string;   // 所在对象属性键名 (如 placeholder/className/children)
    argIndex?: number;  // 所在函数调用的实参下标 (如 createElement 第 0 参为标签名)
    // AI 判定结果 (仅标注，不自动改数据)
    aiVerdict?: AiVerdict;
    aiReason?: string;
    aiConfidence?: number;
    /** 人工标记：确认"不需要翻译"，与 AI 判定分离 */
    ignored?: boolean;
    /** 运行时标记：译文由翻译记忆自动回填（不落盘，重新加载后消失） */
    tmHit?: boolean;
}

export type DiagnoseError = {
    type: 'ast' | 'regex';
    id: number;
    source: string;
    isUnused?: boolean;
    /** 逻辑审计命中项：已翻译但实际是逻辑字符串，替换后功能会静默失效 */
    isLogic?: boolean;
    severity?: 'error' | 'warning' | 'critical';
    message?: string;
};

// ======================== Slice Interfaces ========================

export interface AstSlice {
    // ========== 基础状态 ==========
    /** AST项列表 */
    astItems: AstItem[];

    // ========== 操作 ==========
    /** 初始化AST项列表 */
    setAstItems: (items: AstItem[]) => void;
    /** 添加新AST项 */
    addAstItem: (item: AstItem) => void;
    /** 更新指定ID的AST项译文 */
    updateAstItem: (id: number, target: string) => void;
    /** 删除指定ID的AST项 */
    deleteAstItem: (id: number) => void;
    /** 重置指定ID的AST项（译文重置为原文） */
    resetAstItem: (id: number) => void;
    /** 批量更新AST项 */
    updateAstItems: (items: { id: number; updates: Partial<AstItem> }[]) => void;
    /** 删除所有未翻译的AST项 */
    deleteUntranslatedAstItems: () => void;
    /** 批量删除指定ID集合的AST项 */
    deleteAstItemsByIds: (ids: number[]) => void;
    /** 批量还原指定ID集合的AST项（译文重置为原文） */
    resetAstItemsByIds: (ids: number[]) => void;
}

export interface RegexSlice {
    // ========== 基础状态 ==========
    /** 正则项列表 */
    regexItems: RegexItem[];

    /**
     * 视图开关：隐藏「会被 AST 翻译抢先替换、因而永不生效」的正则条目。
     * 只影响列表渲染，不修改任何数据；关闭后条目原样恢复显示。
     */
    hideAstCoveredRegex: boolean;
    setHideAstCoveredRegex: (value: boolean) => void;

    /**
     * 上述过滤的判定结果（被 AST 已翻译条目覆盖的 Regex source 集合）。
     * 由编辑层在数据/源码变化时计算后写入，仅供渲染层读取。
     */
    astCoveredRegexSources: string[];
    setAstCoveredRegexSources: (sources: string[]) => void;

    /**
     * 正则表格的多选：参与「仅翻译选中」的条目 id 集合。
     * 仅存于内存；为空表示未选中，翻译范围回到「全部待翻译条目」。
     */
    selectedRegexIds: number[];
    setSelectedRegexIds: (ids: number[]) => void;

    // ========== 条目操作 ==========
    /** 初始化正则项列表 */
    setRegexItems: (items: RegexItem[]) => void;
    /** 添加新正则项 */
    addRegexItem: (newItem: RegexItem) => void;
    /** 更新指定ID的正则项 */
    updateRegexItem: (id: number, updates: Partial<PluginTranslationV1Regex>) => void;
    /** 删除指定ID的正则项 */
    deleteRegexItem: (id: number) => void;
    /** 重置指定ID的目标文本为源文本 */
    resetRegexItem: (id: number) => void;
    /** 批量更新正则项 */
    updateRegexItems: (items: { id: number; updates: Partial<PluginTranslationV1Regex> }[]) => void;
    /** 删除所有未翻译的正则项 */
    deleteUntranslatedRegexItems: () => void;
}

export interface MetadataSlice {
    // ========== 基础状态 ==========
    /** 元数据 */
    metadata: PluginTranslationV1Metadata | null;

    // ========== 操作 ==========
    /** 初始化元数据 */
    setMetadata: (metadata: PluginTranslationV1Metadata) => void;
    /** 更新元数据 */
    updateMetadata: (updates: Partial<PluginTranslationV1Metadata>) => void;
}

/**
 * 源码文件的磁盘指纹。
 * 用于识别源码是否被替换（插件更新、手动改写等），从而让过期的源码缓存失效。
 */
export interface SourceFingerprint {
    /** 文件修改时间 (ms) */
    mtimeMs: number;
    /** 文件字节数 */
    size: number;
}

/** 源码缓存条目 */
export interface SourceCacheEntry {
    code: string;
    /** 取源时的 mtime；null 表示来源无磁盘对应物（如备份内容），不做失效校验 */
    mtimeMs: number | null;
    /** 取源时的字节数 */
    size: number;
}

export interface DictSlice {
    // ========== 基础状态 ==========
    /** 完整的字典树数据 */
    dictData: Record<string, PluginTranslationFileDict>;
    /** 当前选中的文件 */
    currentFile: string;

    // ========== 操作 ==========
    /** 初始化整个 Dict 数据 */
    setDictData: (data: Record<string, PluginTranslationFileDict>) => void;
    /** 切换当前文件，这应该保存前一个文件的内容并加载新文件的内容 */
    setCurrentFile: (file: string) => void;
    /** 新增一个文件路径到字典中 */
    addFile: (file: string) => void;
    /** 删除指定文件路径 */
    deleteFile: (file: string) => void;
    /** 更新指定文件中的内容（用于保存前的同步） */
    syncFileDictInfo: (file: string, astItems: AstItem[], regexItems: RegexItem[]) => void;
    /**
     * 同步人工标记到当前文件的 ignoredKeys 集合（随翻译文件持久化）。
     * 保证条目被删除后重新提取时，命中集合的新条目自动恢复 ignored 标记。
     */
    applyIgnoredKeys: (kind: 'ast' | 'regex', added: string[], removed: string[]) => void;
    /** 源码缓存（文件名 -> 源码条目，附带失效指纹） */
    sourceCache: Record<string, SourceCacheEntry>;
    /**
     * 设置指定文件的源码缓存。
     * fingerprint 缺省/为 null 表示来源无磁盘对应物（如备份内容），不做失效校验。
     */
    setSourceCache: (file: string, code: string, fingerprint?: SourceFingerprint | null) => void;
    /** 全局搜索过滤 */
    searchQuery: string;
    setSearchQuery: (query: string) => void;
}

// RegexStore ====================================================================================================
export type RegexStore = RegexSlice & AstSlice & MetadataSlice & DictSlice;
