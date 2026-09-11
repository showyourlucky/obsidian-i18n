import React, { useMemo, useState, useCallback, useDeferredValue, useEffect } from 'react';
import { Search, RotateCcw, Trash2, X, Sparkles, Loader2, WholeWord, Square, EyeOff, Eye } from 'lucide-react';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button, Checkbox } from '@/src/shadcn';
import { useTranslation } from 'react-i18next';
import { useRegexStore } from '../../store';
import { sourceCacheKey } from '../../types';
import { EDITOR_EVENTS } from '../../events';
import { ASTTable } from './ast-table';
import { useAstJudge } from './use-ast-judge';

type FilterType = 'all' | 'translated' | 'untranslated';
type NameFilter = 'all' | string;

/**
 * 判定「单个单词」：无空白字符且长度受限的源文案
 * 这类短串最常出现在难以判断是否该翻的场景 (标识符 / 短标签 / 状态值)，
 * 故作为快速筛选项，便于集中交给 AI 判定或人工复核。
 */
const isSingleWord = (text?: string): boolean => {
    if (!text) return false;
    const s = text.trim();
    if (!s || s.length > 32) return false;
    return !/\s/.test(s);
};

interface Props {
    // 不再需要 sidebar 相关 props
}

const AstEditor: React.FC<Props> = () => {
    const { t } = useTranslation();
    // 搜索
    const searchQuery = useRegexStore.use.searchQuery();
    const setSearchQuery = useRegexStore.use.setSearchQuery();
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [nameFilter, setNameFilter] = useState<NameFilter>('all');
    // AI 判定状态过滤
    const [aiFilter, setAiFilter] = useState<string>('all');
    // 快速筛选：仅显示「单个单词」条目 (多为难以判断是否该翻的短文案)
    const [wordOnly, setWordOnly] = useState(false);
    // 标记项筛选：all=全部 / hide=隐藏待删 / only=只看待删（复核后删除或重置标记）
    const [ignoredFilter, setIgnoredFilter] = useState<'all' | 'hide' | 'only'>('all');

    // 批量选择状态（仅在本地组件维护，不持久化到 store）
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // 搜索防抖：使用 useDeferredValue 延迟过滤计算
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const deferredFilterType = useDeferredValue(filterType);
    const deferredNameFilter = useDeferredValue(nameFilter);
    const deferredAiFilter = useDeferredValue(aiFilter);
    const deferredWordOnly = useDeferredValue(wordOnly);
    const deferredIgnoredFilter = useDeferredValue(ignoredFilter);

    // AST数据（从store获取）
    const astItems = useRegexStore.use.astItems();
    const deleteAstItem = useRegexStore.use.deleteAstItem();
    const resetAstItem = useRegexStore.use.resetAstItem();
    const deleteAstItemsByIds = useRegexStore.use.deleteAstItemsByIds();
    const resetAstItemsByIds = useRegexStore.use.resetAstItemsByIds();
    const updateAstItems = useRegexStore.use.updateAstItems();

    // AI 判定 (选中项是否需要翻译)
    const { state: judgeState, actions: judgeActions } = useAstJudge();

    // 当前编辑项ID
    const [editingId, setEditingId] = useState<number | null>(null);

    const astItemsRef = React.useRef(astItems);
    React.useEffect(() => {
        astItemsRef.current = astItems;
    }, [astItems]);

    // Cleanup when file switches
    const currentFile = useRegexStore.use.currentFile();
    // 源码预览：取内存缓存中的原始代码 (与诊断/逻辑审计同口径)
    // 缓存键带 pluginId：同名 main.js 在不同插件间绝不能互相复用
    const metadata = useRegexStore.use.metadata();
    const sourceCache = useRegexStore.use.sourceCache();
    const sourceCode = currentFile && metadata
        ? (sourceCache?.[sourceCacheKey(metadata.plugin, currentFile)]?.code ?? '')
        : '';

    // 源码懒加载：上下文弹窗打开时请求主编辑器取源。
    // 已有缓存时也要请求一次——主编辑器会用文件指纹校验缓存是否被插件更新作废；
    // 这种情况不显示 loading（静默刷新），只有真正无源码可展示时才提示。
    const [isLoadingSource, setIsLoadingSource] = useState(false);
    const sourceTimerRef = React.useRef<number | null>(null);
    const handleNeedSource = useCallback(() => {
        if (!sourceCode) setIsLoadingSource(true);
        window.dispatchEvent(new CustomEvent(EDITOR_EVENTS.LoadSource));
        // 兜底：即使完成事件丢失（如无主编辑器监听），也不至于永久停在 loading
        if (sourceTimerRef.current) window.clearTimeout(sourceTimerRef.current);
        sourceTimerRef.current = window.setTimeout(() => setIsLoadingSource(false), 10000);
    }, [sourceCode]);
    React.useEffect(() => {
        const handler = () => {
            if (sourceTimerRef.current) window.clearTimeout(sourceTimerRef.current);
            setIsLoadingSource(false);
        };
        window.addEventListener(EDITOR_EVENTS.SourceLoaded, handler);
        return () => window.removeEventListener(EDITOR_EVENTS.SourceLoaded, handler);
    }, []);
    React.useEffect(() => {
        setEditingId(null);
        setSelectedIds(new Set());
        setIgnoredFilter('all');
    }, [currentFile]);

    React.useEffect(() => {
        const handleJump = (e: CustomEvent<{ type: string, id: number }>) => {
            if (e.detail.type === 'ast') {
                const item = astItemsRef.current.find(i => i.id === e.detail.id);
                if (item && item.source) {
                    setFilterType('all');
                    setNameFilter('all');
                    setSearchQuery(item.source);
                }
                setEditingId(e.detail.id);
            }
        };
        window.addEventListener(EDITOR_EVENTS.JumpError, handleJump as EventListener);
        return () => window.removeEventListener(EDITOR_EVENTS.JumpError, handleJump as EventListener);
    }, [setSearchQuery]);

    // 提取所有不同的 name 值，用于名称下拉筛选
    const nameOptions = useMemo(() => {
        const names = new Set<string>();
        for (const item of astItems) {
            if (item.name) names.add(item.name);
        }
 return Array.from(names).sort();
    }, [astItems]);

    // 已人工标记为「不需要翻译」的条目数（用于筛选开关上的计数）
    const ignoredCount = useMemo(() => {
        let count = 0;
        for (const item of astItems) if (item.ignored) count++;
        return count;
    }, [astItems]);

    // 过滤后的条目（使用 deferred 值，避免每次按键都同步计算）
    const filteredItems = useMemo(() => {
        let items = astItems;

        // 1. 按状态筛选
        if (deferredFilterType === 'translated') {
            items = items.filter(item => item.target && item.target !== item.source && item.target.trim() !== '');
        } else if (deferredFilterType === 'untranslated') {
            items = items.filter(item => !item.target || item.target === item.source || item.target.trim() === '');
        }

        // 2. 按名称筛选
        if (deferredNameFilter !== 'all') {
            items = items.filter(item => item.name === deferredNameFilter);
        }

        // 3. 按搜索词筛选
        if (deferredSearchQuery.trim()) {
            const query = deferredSearchQuery.toLowerCase();
            items = items.filter(item =>
                (item.source && item.source.toLowerCase().includes(query)) ||
                (item.target && item.target.toLowerCase().includes(query)) ||
                (item.name && item.name.toLowerCase().includes(query)) ||
                (item.type && item.type.toLowerCase().includes(query))
            );
        }
        // 4. 按 AI 判定状态筛选
        if (deferredAiFilter !== 'all') {
            items = items.filter(item => (item.aiVerdict ?? 'unjudged') === deferredAiFilter);
        }
        // 5. 快速筛选：仅单个单词
        if (deferredWordOnly) {
            items = items.filter(item => isSingleWord(item.source));
        }
        // 6. 标记项筛选：hide=隐藏待删 / only=只看待删
        if (deferredIgnoredFilter === 'hide') {
            items = items.filter(item => !item.ignored);
        } else if (deferredIgnoredFilter === 'only') {
            items = items.filter(item => item.ignored);
        }
        return items;
    }, [astItems, deferredSearchQuery, deferredFilterType, deferredNameFilter, deferredAiFilter, deferredWordOnly, deferredIgnoredFilter]);

    // 切换筛选条件时清空选择（避免选中项与当前过滤结果不一致）
    useEffect(() => {
        setSelectedIds(new Set());
    }, [deferredFilterType, deferredNameFilter, deferredAiFilter, deferredWordOnly, deferredIgnoredFilter, currentFile]);

    // 当 astItems 变化导致 ID 重排时，清除失效的选择
    useEffect(() => {
        if (selectedIds.size === 0) return;
        const currentIds = new Set(astItems.map(i => i.id));
        setSelectedIds(prev => {
            const next = new Set<number>();
            for (const id of prev) {
                if (currentIds.has(id)) next.add(id);
            }
            return next.size === prev.size ? prev : next;
        });
    }, [astItems]);

    // 广播选中项给预览面板
    React.useEffect(() => {
        if (editingId !== null) {
            const item = astItems.find(i => i.id === editingId);
            if (item) {
                window.dispatchEvent(new CustomEvent('i18n-item-selected', {
                    detail: {
                        source: item.source,
                        type: 'ast' as const,
                        name: item.name,
                        astType: item.type
                    }
                }));
            }
        } else {
            window.dispatchEvent(new CustomEvent('i18n-item-deselected'));
        }
    }, [editingId, astItems]);

    // 稳定化回调
    const handleRowClick = useCallback((id: number) => {
        setEditingId(id);
    }, []);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    }, []);

    const handleFilterChange = useCallback((v: string) => {
        setFilterType(v as FilterType);
    }, []);

    const handleNameFilterChange = useCallback((v: string) => {
        setNameFilter(v);
    }, []);

    // 批量选择回调
    const handleToggleRowSelect = useCallback((id: number, checked: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const handleToggleSelectAll = useCallback((checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(filteredItems.map(i => i.id)));
        } else {
            setSelectedIds(new Set());
        }
    }, [filteredItems]);

    const handleClearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    // 在源码中查看 (通知主编辑器打开当前文件)
    const handleOpenSource = useCallback(() => {
        window.dispatchEvent(new CustomEvent(EDITOR_EVENTS.OpenSource));
    }, []);

    // 批量删除
    const handleBatchDelete = useCallback(() => {
        // 判定进行中删除条目会导致 store 内 id 重排，批次回写时判定结果错位到其他行
        if (judgeState.isJudging) return;
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        if (!confirm(t('Editor.Notices.ConfirmBatchDelete', { count: ids.length }))) return;
        deleteAstItemsByIds(ids);
        setSelectedIds(new Set());
    }, [selectedIds, deleteAstItemsByIds, t, judgeState.isJudging]);

    // 批量还原
    const handleBatchReset = useCallback(() => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        resetAstItemsByIds(ids);
        setSelectedIds(new Set());
    }, [selectedIds, resetAstItemsByIds]);

    // 批量标记/取消「不需要翻译」（人工标记，重跑 AI 判定不会清掉）
    const handleBatchIgnore = useCallback((ignored: boolean) => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        updateAstItems(ids.map(id => ({ id, updates: { ignored } })));
        setSelectedIds(new Set());
    }, [selectedIds, updateAstItems]);

    // AI 判定选中项（仅标注，不改 source/target，不删除）
    const handleJudge = useCallback(() => {
        const items = astItems.filter(i => selectedIds.has(i.id));
        if (items.length === 0) return;
        judgeActions.judge(items);
    }, [astItems, selectedIds, judgeActions]);

    // 当前过滤结果中已选中的数量（用于全选 checkbox 的 indeterminate 状态）
    const filteredIdSet = useMemo(() => new Set(filteredItems.map(i => i.id)), [filteredItems]);
    const selectedInFilter = useMemo(() => {
        let count = 0;
        for (const id of selectedIds) {
            if (filteredIdSet.has(id)) count++;
        }
        return count;
    }, [selectedIds, filteredIdSet]);
    const isAllSelected = filteredItems.length > 0 && selectedInFilter === filteredItems.length;
    const isIndeterminate = selectedInFilter > 0 && selectedInFilter < filteredItems.length;

    return (
        <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
                {/* 搜索框区域 */}
                <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input className="h-8 w-64 pl-8"
                                placeholder={t('Common.Placeholders.Search')}
                                value={searchQuery}
                                onChange={handleSearchChange}
                            />
                        </div>
                        <Select value={filterType} onValueChange={handleFilterChange}>
                            <SelectTrigger size="sm" className="w-[100px]">
                                <SelectValue placeholder={t('Common.Labels.Filter')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('Editor.Filters.TransAll', '全部翻译')}</SelectItem>
                                <SelectItem value="translated">{t('Common.Filters.Translated')}</SelectItem>
                                <SelectItem value="untranslated">{t('Common.Filters.Untranslated')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={nameFilter} onValueChange={handleNameFilterChange}>
                            <SelectTrigger size="sm" className="w-[140px]">
                                <SelectValue placeholder={t('Editor.Labels.Name')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('Editor.Filters.NameAll')}</SelectItem>
                                {nameOptions.map(name => (
                                    <SelectItem key={name} value={name}>{name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={aiFilter} onValueChange={(v) => setAiFilter(v)}>
                            <SelectTrigger size="sm" className="w-[110px]">
                                <SelectValue placeholder={t('Editor.Labels.AiFilter', 'AI 判定')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('Editor.Filters.AiAll', '全部判定')}</SelectItem>
                                <SelectItem value="unjudged">{t('Editor.Verdict.Unjudged', '待判断')}</SelectItem>
                                <SelectItem value="translatable">{t('Editor.Verdict.Translatable', '该翻')}</SelectItem>
                                <SelectItem value="untranslatable">{t('Editor.Verdict.Untranslatable', '不该翻')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {/* 快速筛选：开关型，与左侧分类下拉语义正交，故单独置于右侧 */}
                    <Button
                        variant={wordOnly ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => setWordOnly(v => !v)}
                        title={t('Editor.Filters.WordOnlyTip', '仅显示无空格的单个单词（多为难以判断是否该翻的短文案）')}
                    >
                        <WholeWord className="w-3.5 h-3.5 mr-1" />
                        {t('Editor.Filters.WordOnly', '仅单词')}
                    </Button>
                    {/* 标记项查看方式：「只看待删」是标记项的复核入口，可批量删除或重置标记 */}
                    <Select value={ignoredFilter} onValueChange={(v) => setIgnoredFilter(v as 'all' | 'hide' | 'only')}>
                        <SelectTrigger size="sm" className="w-[124px]" title={t('Editor.Filters.IgnoredViewTip', '「不需要翻译」标记项的查看方式')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('Editor.Filters.IgnoredAll', '全部')}</SelectItem>
                            <SelectItem value="hide">{t('Editor.Filters.IgnoredHide', '隐藏待删')}</SelectItem>
                            <SelectItem value="only">{t('Editor.Filters.IgnoredOnly', { count: ignoredCount, defaultValue: '只看待删 ({{count}})' })}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* 批量操作工具栏（仅在有选中项时显示） */}
                {selectedIds.size > 0 && (
                    <div className="mb-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border bg-primary/5">
                        <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-primary">
                                {t('Editor.Labels.SelectedCount', { count: selectedIds.size })}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                onClick={handleClearSelection}
                            >
                                <X className="w-3 h-3 mr-1" />
                                {t('Editor.Actions.ClearSelection')}
                            </Button>
                        </div>
                        <div className="flex items-center gap-1">
                            {judgeState.isJudging ? (
                                <div className="flex items-center gap-2 px-1">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                    <span className="text-xs text-muted-foreground tabular-nums">{judgeState.progress}%</span>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={judgeActions.handleStop}
                                        title={t('Common.Actions.StopJudge', '停止判定')}
                                    >
                                        <Square className="w-3 h-3 mr-1 fill-current" />
                                        {t('Common.Actions.StopJudge', '停止判定')}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={handleJudge}
                                    title={t('Editor.Actions.JudgeSelected', 'AI 判定选中项')}
                                >
                                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                                    {t('Editor.Actions.JudgeSelected', 'AI 判定选中项')}
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-primary"
                                onClick={handleBatchReset}
                                title={t('Editor.Actions.BatchRestore')}
                            >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                {t('Editor.Actions.BatchRestore')}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-amber-600"
                                onClick={() => handleBatchIgnore(true)}
                                title={t('Editor.Actions.MarkIgnoredTip', '标记为不需要翻译（待手动删除）；标记错了可在「只看待删」中重置')}
                            >
                                <EyeOff className="w-3.5 h-3.5 mr-1" />
                                {t('Editor.Actions.MarkIgnored', '不需要翻译')}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-primary"
                                onClick={() => handleBatchIgnore(false)}
                                title={t('Editor.Actions.ClearIgnored', '取消标记')}
                            >
                                <Eye className="w-3.5 h-3.5 mr-1" />
                                {t('Editor.Actions.ClearIgnored', '取消标记')}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                                onClick={handleBatchDelete}
                                title={t('Editor.Actions.BatchDelete')}
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-1" />
                                {t('Editor.Actions.BatchDelete')}
                            </Button>
                        </div>
                    </div>
                )}

                {/* AST条目表格 */}
                <div className="flex-1 overflow-hidden h-full">
                    <ASTTable
                        key={currentFile}
                        data={filteredItems}
                        editingId={editingId}
                        onRowClick={handleRowClick}
                        onDelete={deleteAstItem}
                        onReset={resetAstItem}
                        selectedIds={selectedIds}
                        onToggleRowSelect={handleToggleRowSelect}
                        isAllSelected={isAllSelected}
                        isIndeterminate={isIndeterminate}
                        onToggleSelectAll={handleToggleSelectAll}
                        sourceCode={sourceCode}
                        onOpenSource={handleOpenSource}
                        onNeedSource={handleNeedSource}
                        isLoadingSource={isLoadingSource}
                        judging={judgeState.isJudging}
                    />
                </div>
            </div>
        </div>
    );
};

export { AstEditor };
