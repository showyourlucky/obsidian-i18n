import React, { useMemo, useCallback, useDeferredValue } from 'react';
import { Search, FilterX } from 'lucide-react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/shadcn';
import { useTranslation } from 'react-i18next';

import { useRegexStore } from '../../store';
import { EDITOR_EVENTS } from '../../events';
import { RegexTable } from '../..';

interface Props {
    // 不再需要 sidebar 相关 props
}

type FilterType = 'all' | 'translated' | 'untranslated';

const RegexEditor: React.FC<Props> = () => {
    const { t } = useTranslation();
    // 搜索
    const searchQuery = useRegexStore.use.searchQuery();
    const setSearchQuery = useRegexStore.use.setSearchQuery();
    const [filterType, setFilterType] = React.useState<FilterType>('all');
    // 标记项筛选：all=全部 / hide=隐藏待删 / only=只看待删（复核后删除或重置标记）
    const [ignoredFilter, setIgnoredFilter] = React.useState<'all' | 'hide' | 'only'>('all');

    // 搜索防抖：使用 useDeferredValue 延迟过滤计算
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const deferredFilterType = useDeferredValue(filterType);
    const deferredIgnoredFilter = useDeferredValue(ignoredFilter);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    }, []);

    const [editingId, setEditingId] = React.useState<number | null>(null);

    // 获取数据
    const regexItems = useRegexStore.use.regexItems();

    // 多选：选中项用于「仅翻译选中」；为空时翻译全部待翻译条目
    const selectedRegexIds = useRegexStore.use.selectedRegexIds();
    const setSelectedRegexIds = useRegexStore.use.setSelectedRegexIds();
    const selectedIdSet = useMemo(() => new Set(selectedRegexIds), [selectedRegexIds]);

    // 「隐藏 AST 已翻译覆盖项」：判定在编辑层算好写入 store，这里只做查询与渲染过滤
    const hideAstCoveredRegex = useRegexStore.use.hideAstCoveredRegex();
    const setHideAstCoveredRegex = useRegexStore.use.setHideAstCoveredRegex();
    const astCoveredRegexSources = useRegexStore.use.astCoveredRegexSources();

    const astCoveredSet = useMemo(
        () => new Set(astCoveredRegexSources),
        [astCoveredRegexSources]
    );

    /** 当前会被隐藏的条目数，用于开关上的计数 */
    const astCoveredCount = useMemo(() => {
        let count = 0;
        for (const item of regexItems) if (astCoveredSet.has(item.source)) count++;
        return count;
    }, [regexItems, astCoveredSet]);

    const regexItemsRef = React.useRef(regexItems);
    React.useEffect(() => {
        regexItemsRef.current = regexItems;
    }, [regexItems]);

    // Cleanup when file switches
    const currentFile = useRegexStore.use.currentFile();
    React.useEffect(() => {
        setEditingId(null);
        setFilterType('all');
        setIgnoredFilter('all');
        setSearchQuery('');
        setSelectedRegexIds([]);
    }, [currentFile, setSearchQuery, setSelectedRegexIds]);

    // 切换筛选条件（含搜索词）或视图过滤时清空选择，避免出现「选中了但看不见」
    React.useEffect(() => {
        setSelectedRegexIds([]);
    }, [filterType, ignoredFilter, hideAstCoveredRegex, deferredSearchQuery, currentFile, setSelectedRegexIds]);

    // 条目被删除/重新提取导致 id 重排时，清掉已失效的选择
    React.useEffect(() => {
        if (selectedRegexIds.length === 0) return;
        const currentIds = new Set(regexItems.map(i => i.id));
        const next = selectedRegexIds.filter(id => currentIds.has(id));
        if (next.length !== selectedRegexIds.length) setSelectedRegexIds(next);
    }, [regexItems, selectedRegexIds, setSelectedRegexIds]);

    React.useEffect(() => {
        const handleJump = (e: CustomEvent<{ type: string, id: number }>) => {
            if (e.detail.type === 'regex') {
                const item = regexItemsRef.current.find(i => i.id === e.detail.id);
                if (item && item.source) {
                    setFilterType('all');
                    setSearchQuery(item.source);
                }
                setEditingId(e.detail.id);
            }
        };
        window.addEventListener(EDITOR_EVENTS.JumpError, handleJump as EventListener);
        return () => window.removeEventListener(EDITOR_EVENTS.JumpError, handleJump as EventListener);
    }, [setSearchQuery]);

    // 已人工标记为「不需要翻译」的条目数（用于筛选开关上的计数）
    const ignoredCount = useMemo(() => {
        let count = 0;
        for (const item of regexItems) if (item.ignored) count++;
        return count;
    }, [regexItems]);

    // 过滤后的条目（使用 deferred 值）
    const filteredItems = useMemo(() => {
        let items = regexItems;

        // 1. 按状态筛选
        if (deferredFilterType === 'translated') {
            items = items.filter(item => item.target && item.target !== item.source);
        } else if (deferredFilterType === 'untranslated') {
            items = items.filter(item => !item.target || item.target === item.source);
        }

        // 2. 按搜索词筛选
        if (deferredSearchQuery.trim()) {
            const query = deferredSearchQuery.toLowerCase();
            items = items.filter(item =>
                (item.source && item.source.toLowerCase().includes(query)) ||
                (item.target && item.target.toLowerCase().includes(query))
            );
        }

        // 3. 标记项筛选：hide=隐藏待删 / only=只看待删
        if (deferredIgnoredFilter === 'hide') {
            items = items.filter(item => !item.ignored);
        } else if (deferredIgnoredFilter === 'only') {
            items = items.filter(item => item.ignored);
        }

        // 4. 隐藏「会被 AST 翻译抢先替换、因而永不生效」的条目（纯视图过滤，不改数据）
        if (hideAstCoveredRegex && astCoveredSet.size > 0) {
            items = items.filter(item => !astCoveredSet.has(item.source));
        }
        return items;
    }, [regexItems, deferredSearchQuery, deferredFilterType, deferredIgnoredFilter, hideAstCoveredRegex, astCoveredSet]);

    // ---- 多选 ----
    const handleToggleRowSelect = useCallback((id: number, checked: boolean) => {
        const next = new Set(useRegexStore.getState().selectedRegexIds);
        if (checked) next.add(id);
        else next.delete(id);
        setSelectedRegexIds(Array.from(next));
    }, [setSelectedRegexIds]);

    const handleToggleSelectAll = useCallback((checked: boolean) => {
        setSelectedRegexIds(checked ? filteredItems.map(i => i.id) : []);
    }, [filteredItems, setSelectedRegexIds]);

    /** 当前过滤结果中被选中的数量，用于表头全选 / 半选态 */
    const filteredIdSet = useMemo(() => new Set(filteredItems.map(i => i.id)), [filteredItems]);
    const selectedInFilter = useMemo(() => {
        let count = 0;
        for (const id of selectedRegexIds) if (filteredIdSet.has(id)) count++;
        return count;
    }, [selectedRegexIds, filteredIdSet]);
    const isAllSelected = filteredItems.length > 0 && selectedInFilter === filteredItems.length;
    const isIndeterminate = selectedInFilter > 0 && selectedInFilter < filteredItems.length;

    // 广播选中项给预览面板
    React.useEffect(() => {
        if (editingId !== null) {
            const item = regexItems.find(i => i.id === editingId);
            if (item) {
                window.dispatchEvent(new CustomEvent('i18n-item-selected', {
                    detail: {
                        source: item.source,
                        type: 'regex' as const,
                    }
                }));
            }
        } else {
            window.dispatchEvent(new CustomEvent('i18n-item-deselected'));
        }
    }, [editingId, regexItems]);

    const handleFilterChange = useCallback((v: string) => {
        setFilterType(v as FilterType);
    }, []);

    return (
        <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
                {/* 搜索框区域 */}
                <div className="mb-2 flex items-center justify-between">
                    {/* 左侧：搜索框和按钮 */}
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input className="h-8 w-64 pl-8" placeholder={t('Common.Placeholders.Search')} value={searchQuery} onChange={handleSearchChange} />
                        </div>
                        <Select value={filterType} onValueChange={handleFilterChange}>
                            <SelectTrigger size="sm" className="w-[100px]">
                                <SelectValue placeholder={t('Common.Labels.Filter')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('Common.Filters.All')}</SelectItem>
                                <SelectItem value="translated">{t('Common.Filters.Translated')}</SelectItem>
                                <SelectItem value="untranslated">{t('Common.Filters.Untranslated')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {/* 隐藏 AST 已覆盖项 + 标记项查看方式：「只看待删」是标记项的复核入口，可逐行删除或重置标记 */}
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            aria-pressed={hideAstCoveredRegex}
                            data-active={hideAstCoveredRegex || undefined}
                            className={`h-8 gap-1.5 text-xs transition-all ${hideAstCoveredRegex
                                ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600 hover:text-white shadow-sm font-semibold'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                            onClick={() => setHideAstCoveredRegex(!hideAstCoveredRegex)}
                            disabled={astCoveredCount === 0 && !hideAstCoveredRegex}
                            title={t('Editor.Filters.HideAstCoveredTip', '隐藏会被 AST 翻译抢先替换、因而永不生效的条目（纯视图过滤，不修改数据）')}
                        >
                            <FilterX className="w-3.5 h-3.5" />
                            {t('Editor.Filters.HideAstCovered', { count: astCoveredCount, defaultValue: '隐藏 AST 已覆盖 ({{count}})' })}
                        </Button>
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
                </div>

                {/* 过滤生效时的说明：避免列表变空被误认为数据丢失 */}
                {hideAstCoveredRegex && astCoveredCount > 0 && (
                    <div className="mb-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                        {t('Editor.Filters.AstCoveredHiddenTip', {
                            count: astCoveredCount,
                            defaultValue: '已隐藏 {{count}} 条会被 AST 翻译抢先替换的条目（即使有译文也不会生效）。这只是视图过滤，不影响翻译范围；要跳过它们请在表格中勾选后翻译选中项。数据未被修改，关闭该开关即可查看。'
                        })}
                    </div>
                )}

                {/* 表格内容区域 */}
                <div className="flex-1 overflow-hidden">
                    <RegexTable
                        key={currentFile}
                        data={filteredItems}
                        editingId={editingId}
                        onEditingIdChange={setEditingId}
                        selectedIds={selectedIdSet}
                        onToggleRowSelect={handleToggleRowSelect}
                        isAllSelected={isAllSelected}
                        isIndeterminate={isIndeterminate}
                        onToggleSelectAll={handleToggleSelectAll}
                    />
                </div>
            </div>
        </div>
    );
};

export { RegexEditor };
