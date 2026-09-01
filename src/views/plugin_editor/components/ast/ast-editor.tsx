import React, { useMemo, useState, useCallback, useDeferredValue, useEffect } from 'react';
import { Search, RotateCcw, Trash2, X } from 'lucide-react';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button, Checkbox } from '@/src/shadcn';
import { useTranslation } from 'react-i18next';
import { useRegexStore } from '../../store';
import { ASTTable } from './ast-table';

type FilterType = 'all' | 'translated' | 'untranslated';
type NameFilter = 'all' | string;

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

    // 批量选择状态（仅在本地组件维护，不持久化到 store）
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // 搜索防抖：使用 useDeferredValue 延迟过滤计算
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const deferredFilterType = useDeferredValue(filterType);
    const deferredNameFilter = useDeferredValue(nameFilter);

    // AST数据（从store获取）
    const astItems = useRegexStore.use.astItems();
    const deleteAstItem = useRegexStore.use.deleteAstItem();
    const resetAstItem = useRegexStore.use.resetAstItem();
    const deleteAstItemsByIds = useRegexStore.use.deleteAstItemsByIds();
    const resetAstItemsByIds = useRegexStore.use.resetAstItemsByIds();

    // 当前编辑项ID
    const [editingId, setEditingId] = useState<number | null>(null);

    const astItemsRef = React.useRef(astItems);
    React.useEffect(() => {
        astItemsRef.current = astItems;
    }, [astItems]);

    // Cleanup when file switches
    const currentFile = useRegexStore.use.currentFile();
    React.useEffect(() => {
        setEditingId(null);
        setSelectedIds(new Set());
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
        window.addEventListener('i18n-jump-error', handleJump as EventListener);
        return () => window.removeEventListener('i18n-jump-error', handleJump as EventListener);
    }, [setSearchQuery]);

    // 提取所有不同的 name 值，用于名称下拉筛选
    const nameOptions = useMemo(() => {
        const names = new Set<string>();
        for (const item of astItems) {
            if (item.name) names.add(item.name);
        }
 return Array.from(names).sort();
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
        return items;
    }, [astItems, deferredSearchQuery, deferredFilterType, deferredNameFilter]);

    // 切换筛选条件时清空选择（避免选中项与当前过滤结果不一致）
    useEffect(() => {
        setSelectedIds(new Set());
    }, [deferredFilterType, deferredNameFilter, currentFile]);

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

    // 批量删除
    const handleBatchDelete = useCallback(() => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        if (!confirm(t('Editor.Notices.ConfirmBatchDelete', { count: ids.length }))) return;
        deleteAstItemsByIds(ids);
        setSelectedIds(new Set());
    }, [selectedIds, deleteAstItemsByIds, t]);

    // 批量还原
    const handleBatchReset = useCallback(() => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        resetAstItemsByIds(ids);
        setSelectedIds(new Set());
    }, [selectedIds, resetAstItemsByIds]);

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
                                <SelectItem value="all">{t('Common.Filters.All')}</SelectItem>
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
                    </div>
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
                    />
                </div>
            </div>
        </div>
    );
};

export { AstEditor };
