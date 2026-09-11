import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    TableHead,
    TableHeader,
    TableRow,
    TableBody,
    TableCell,
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '~/shadcn';
import { RotateCcw, Trash2, MapPin, FileCode2, Loader2, EyeOff, Eye } from 'lucide-react';
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from '@tanstack/react-virtual';
import { AstItem, DiagnoseError } from '../../types';
import { EDITOR_EVENTS } from '../../events';
import { IgnoredBadge } from '../common/ignored-badge';
import { MemoryBadge } from '../common/memory-badge';
import { ASTTableEmptyState } from './ast-table-empty-state';
import { HeaderCheckbox, RowCheckbox } from '../common/selection-checkbox';
import { useRegexStore } from '../../store';
import { getSourceContext, createSourceContextCache } from '@/src/utils/common/source-context';

interface Props {
    data: AstItem[];
    editingId: number | null;
    onRowClick: (id: number) => void;
    onDelete: (id: number) => void;
    onReset: (id: number) => void;
    selectedIds?: Set<number>;
    onToggleRowSelect?: (id: number, checked: boolean) => void;
    isAllSelected?: boolean;
    isIndeterminate?: boolean;
    onToggleSelectAll?: (checked: boolean) => void;
    // 上下文预览
    sourceCode?: string;
    onOpenSource?: () => void;
    /** 弹窗打开且源码缓存未命中时触发懒加载 */
    onNeedSource?: () => void;
    /** 源码懒加载进行中 */
    isLoadingSource?: boolean;
    /** AI 判定进行中：禁用删除（防御性——判定结果按 id 回写，避免条目中途变动导致错位） */
    judging?: boolean;
}

// 颜色样式缓存，避免每次渲染重复计算哈希
const colorStyleCache = new Map<string, React.CSSProperties>();
const getColorStyle = (str: string): React.CSSProperties => {
    const cached = colorStyleCache.get(str);
    if (cached) return cached;

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const style = { '--item-hue': hue } as React.CSSProperties;
    colorStyleCache.set(str, style);
    return style;
};

// Target Cell with inline editing
const TargetCell = React.memo(({
    id,
    source,
    target,
    updateItem,
    onEditingIdChange
}: {
    id: number,
    source: string,
    target: string,
    updateItem: (id: number, data: string) => void,
    onEditingIdChange: (id: number | null) => void
}) => {
    const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
        const text = e.currentTarget.textContent || '';
        if (text !== target) {
            updateItem(id, text);
        }
        onEditingIdChange(null);
    }, [id, target, updateItem, onEditingIdChange]);

    const handleFocus = useCallback(() => {
        onEditingIdChange(id);
    }, [id, onEditingIdChange]);

    return (
        <div
            key={`cell-${id}-${source.slice(0, 10)}`}
            contentEditable
            suppressContentEditableWarning
            onFocus={handleFocus}
            onBlur={handleBlur}
            className="min-h-[32px] w-full text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary p-1 rounded break-all whitespace-pre-wrap"
        >
            {target}
        </div>
    );
}, (prev, next) => {
    return prev.id === next.id && prev.target === next.target && prev.source === next.source;
});

// 定位单元格：显示行号/偏移，点击打开源码上下文弹窗
// onOpen 接受 item 参数而非闭包内联，配合父级 useCallback 保持引用稳定，memo 才真正生效
const LocateCell = React.memo(({ item, onOpen }: { item: AstItem; onOpen: (item: AstItem) => void }) => {
    const hasLoc = item.line != null || item.start != null;
    const label = item.line ? `L${item.line}` : (item.start != null ? `⤓${item.start}` : '·');
    const tooltip = item.start != null
        ? `start: ${item.start}${item.end != null ? ` end: ${item.end}` : ''}${item.line ? ` · line: ${item.line}` : ''}`
        : 'no location';
    return (
        <div className="flex justify-center">
            <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs font-mono text-muted-foreground hover:text-primary"
                onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                title={tooltip}
                disabled={!hasLoc}
            >
                <MapPin className="h-3 w-3 mr-0.5" />
                {label}
            </Button>
        </div>
    );
});

// 源码上下文预览内容（memo 化：判定进行中每批次 store 更新会触发全表重渲染，
// 弹窗开着时避免重复执行 getSourceContext 的全文定位）
const SourceContextView = React.memo(({ item, code, isLoading, onOpenSource }: { item: AstItem; code?: string; isLoading?: boolean; onOpenSource?: () => void }) => {
    const { t } = useTranslation();
    // 按 code 维度缓存定位索引，避免弹窗重渲染时反复全文扫描（缓存随 code 变更重建）
    const cache = useMemo(() => (code ? createSourceContextCache(code) : null), [code]);
    const ctx = cache ? getSourceContext(cache, item) : null;
    // 压缩代码里同一行可能有大量重复文本，回退定位只能取到其中一处，需显式提示歧义
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {ctx
                    // 单行 minified 代码行号恒为 1，无参考意义，改显示字符偏移
                    ? (ctx.line && ctx.lineCount > 1
                        ? t('Editor.Labels.SourceLine', { defaultValue: `行 ${ctx.line}`, line: ctx.line })
                        : t('Editor.Labels.SourceOffsetRange', { defaultValue: `偏移 ${ctx.start}–${ctx.end}`, start: ctx.start, end: ctx.end }))
                    : (isLoading
                        ? <><Loader2 className="h-3 w-3 animate-spin" />{t('Editor.Labels.SourceLoading', '正在读取源码…')}</>
                        : t('Editor.Labels.SourceUnavailable', '无可用源码（未找到原始代码，仅显示条目文本）'))}
                {/* 偏移失效后按行号回退定位：提示记录行与实际行的差异，避免误判预览错位 */}
                {ctx && !ctx.fromCache && item.line != null && ctx.line !== item.line && (
                    <span className="text-amber-600 dark:text-amber-500">
                        {t('Editor.Labels.SourceLineDrift', { defaultValue: `记录行 L${item.line}（源码已变更，按邻近位置定位）`, line: item.line })}
                    </span>
                )}
                {/* 回退定位且源码中存在多处同名文本：位置可能是错的，明确提示而非静默展示 */}
                {ctx && !ctx.fromCache && ctx.occurrences != null && ctx.occurrences > 1 && (
                    <span className="text-amber-600 dark:text-amber-500">
                        {t('Editor.Labels.SourceAmbiguous', { defaultValue: `源码中该文本共 ${ctx.occurrences} 处，当前位置可能不准`, total: ctx.occurrences })}
                    </span>
                )}
            </div>
            {ctx ? (
                <pre className="max-h-[50vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all select-text cursor-text">
                    <span className="text-muted-foreground">{ctx.before}</span>
                    <span className="bg-primary/25 text-primary rounded-sm px-0.5 font-semibold">{ctx.match}</span>
                    <span className="text-muted-foreground">{ctx.after}</span>
                </pre>
            ) : (
                <pre className="max-h-[50vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-all select-text cursor-text">{item.source}</pre>
            )}
            {onOpenSource && (
                <Button variant="outline" size="sm" className="text-xs" onClick={onOpenSource}>
                    <FileCode2 className="h-3.5 w-3.5 mr-1" />
                    {t('Editor.Actions.OpenSource', '在源码中查看')}
                </Button>
            )}
        </div>
    );
});

// AI 判定结果徽章：translatable=绿 / untranslatable=红 / unjudged=灰
const VerdictBadge = React.memo(({ item }: { item: AstItem }) => {
    const { t } = useTranslation();
    const verdict = item.aiVerdict ?? 'unjudged';
    const transLabel = t('Editor.Verdict.Translatable', '该翻');
    const untransLabel = t('Editor.Verdict.Untranslatable', '不该翻');
    if (verdict === 'unjudged') {
        return (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                {t('Editor.Verdict.Unjudged', '待判断')}
            </span>
        );
    }
    const isTrans = verdict === 'translatable';
    const label = isTrans ? transLabel : untransLabel;
    const tip = item.aiReason
        ? `${label} · ${item.aiConfidence != null ? item.aiConfidence.toFixed(2) : '-'} · ${item.aiReason}`
        : label;
    return (
        <span
            title={tip}
            className={
                isTrans
                    ? 'px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30'
                    : 'px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
            }
        >
            {label}
        </span>
    );
});

// 行级 memo 组件（带 forwardRef，供虚拟滚动测量高度）
interface MemoizedAstRowProps {
    row: any;
    isSelected: boolean;
    onRowClick: (id: number) => void;
    getCellClass: (columnId: string) => string;
    dataIndex: number;
    errorType?: 'error' | 'unused' | 'security' | null;
    isChecked?: boolean;
    onToggleRowSelect?: (id: number, checked: boolean) => void;
}

const errorRowStyles: Record<string, string> = {
    error: 'bg-destructive/8 border-l-2 border-l-destructive',
    unused: 'bg-orange-500/8 border-l-2 border-l-orange-500',
    security: 'bg-purple-500/8 border-l-2 border-l-purple-500',
};

const MemoizedAstRowInner = React.forwardRef<HTMLTableRowElement, MemoizedAstRowProps>(
    ({ row, isSelected, onRowClick, getCellClass, dataIndex, errorType, isChecked, onToggleRowSelect }, ref) => {
        const handleClick = useCallback(() => {
            onRowClick(row.original.id);
        }, [row.original.id, onRowClick]);

        const errorClass = errorType ? errorRowStyles[errorType] || '' : '';

        return (
            <TableRow
                ref={ref}
                data-index={dataIndex}
                id={`ast-row-${row.original.id}`}
                data-state={isSelected ? "selected" : undefined}
                className={`cursor-pointer hover:bg-accent/50 ${isSelected ? 'bg-accent' : ''} ${errorClass}`}
                onClick={handleClick}
            >
                {row.getVisibleCells().map((cell: any) => (
                    <TableCell
                        key={cell.id}
                        className={getCellClass(cell.column.id)}
                    >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                ))}
            </TableRow>
        );
    }
);
MemoizedAstRowInner.displayName = 'MemoizedAstRow';

const MemoizedAstRow = React.memo(MemoizedAstRowInner, (prev, next) => {
    return prev.isSelected === next.isSelected
        && prev.row.original === next.row.original
        && prev.errorType === next.errorType
        && prev.isChecked === next.isChecked
        && prev.onToggleRowSelect === next.onToggleRowSelect;
});

export const ASTTable = React.forwardRef<HTMLDivElement, Props>(({ data, editingId, onRowClick, onDelete, onReset, selectedIds, onToggleRowSelect, isAllSelected, isIndeterminate, onToggleSelectAll, sourceCode, onOpenSource, onNeedSource, isLoadingSource, judging }, ref) => {
    const { t } = useTranslation();
    const updateAstItem = useRegexStore.use.updateAstItem();
    const updateAstItems = useRegexStore.use.updateAstItems();
    const parentRef = useRef<HTMLDivElement>(null);

    // 源码上下文预览 (位置列点击打开)
    const [contextItem, setContextItem] = useState<AstItem | null>(null);
    const [ctxOpen, setCtxOpen] = useState(false);

    // 稳定引用：避免 LocateCell 因内联箭头每次重渲染而 memo 失效
    const handleOpenContext = useCallback((item: AstItem) => {
        setContextItem(item);
        setCtxOpen(true);
        onNeedSource?.();
    }, [onNeedSource]);

    // 诊断错误高亮映射 {id -> errorType}
    const [errorMap, setErrorMap] = useState<Map<number, 'error' | 'unused' | 'security'>>(new Map());

    useEffect(() => {
        const handleErrors = (e: CustomEvent<{ errors: DiagnoseError[] }>) => {
            const map = new Map<number, 'error' | 'unused' | 'security'>();
            for (const err of e.detail.errors) {
                if (err.type !== 'ast') continue;
                if (err.severity === 'critical' || err.severity === 'warning') {
                    map.set(err.id, 'security');
                } else if (err.isUnused) {
                    map.set(err.id, 'unused');
                } else {
                    map.set(err.id, 'error');
                }
            }
            setErrorMap(map);
        };
        window.addEventListener(EDITOR_EVENTS.DiagnoseErrors, handleErrors as EventListener);
        return () => window.removeEventListener(EDITOR_EVENTS.DiagnoseErrors, handleErrors as EventListener);
    }, []);

    // 是否启用选择模式
    const selectionEnabled = !!onToggleRowSelect && selectedIds !== undefined;

    const columns = useMemo<ColumnDef<AstItem>[]>(() => {
        const cols: ColumnDef<AstItem>[] = [];

        // 选择列（仅在启用选择模式时显示）
        if (selectionEnabled) {
            cols.push({
                id: "select",
                header: () => (
                    <HeaderCheckbox
                        checked={!!isAllSelected}
                        indeterminate={!!isIndeterminate}
                        onToggle={onToggleSelectAll || (() => {})}
                    />
                ),
                cell: ({ row }) => (
                    <RowCheckbox
                        id={row.original.id}
                        checked={selectedIds?.has(row.original.id) || false}
                        onToggle={onToggleRowSelect!}
                    />
                ),
            });
        }

        // 定位列：显示源码行号/偏移，点击弹出上下文预览
        cols.push({
            id: "locate",
            header: () => <div className="text-center">{t('Editor.Table.ColumnLocate', '定位')}</div>,
            cell: ({ row }) => (
                <LocateCell item={row.original} onOpen={handleOpenContext} />
            ),
        });

        cols.push(
            {
                accessorKey: "type",
                header: ({ column }) => <div className="text-center">{t('Editor.Table.ColumnType')}</div>,
                cell: ({ row }) => (
                    <div className="flex justify-center">
                        <span
                            className="px-2 py-0.5 rounded-md text-xs whitespace-nowrap bg-[hsl(var(--item-hue),85%,96%)] text-[hsl(var(--item-hue),80%,35%)] dark:bg-[hsl(var(--item-hue),60%,20%)] dark:text-[hsl(var(--item-hue),80%,80%)]"
                            style={getColorStyle(row.original.type)}
                        >
                            {row.original.type}
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: "name",
                header: ({ column }) => <div className="text-center">{t('Editor.Table.ColumnName')}</div>,
                cell: ({ row }) => (
                    <div className="flex justify-center">
                        <span
                            className="truncate max-w-[120px] font-mono text-xs px-1.5 py-0.5 rounded text-center bg-[hsl(var(--item-hue),85%,96%)] text-[hsl(var(--item-hue),80%,35%)] dark:bg-[hsl(var(--item-hue),60%,20%)] dark:text-[hsl(var(--item-hue),80%,80%)]"
                            style={getColorStyle(row.original.name)}
                            title={row.original.name}
                        >
                            {row.original.name}
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: "source",
                header: ({ column }) => <div className="text-center">{t('Editor.Table.ColumnSource')}</div>,
                cell: ({ row }) => (
                    <div className="whitespace-pre-wrap break-all text-sm px-1 py-1">
                        {row.original.source}
                    </div>
                ),
            },
            {
                accessorKey: "target",
                header: ({ column }) => <div className="text-center">{t('Editor.Table.ColumnTarget')}</div>,
                cell: ({ row }) => (
                    <TargetCell
                        id={row.original.id}
                        source={row.original.source}
                        target={row.original.target}
                        updateItem={updateAstItem}
                        onEditingIdChange={onRowClick}
                    />
                ),
            },
            {
                id: "verdict",
                header: ({ column }) => <div className="text-center">{t('Editor.Table.ColumnVerdict', 'AI 判定')}</div>,
                cell: ({ row }) => (
                    <div className="flex justify-center items-center gap-1 flex-wrap">
                        <VerdictBadge item={row.original} />
                        {row.original.ignored && <IgnoredBadge />}
                        {row.original.tmHit && <MemoryBadge />}
                    </div>
                ),
            },
            {
                id: "actions",
                header: ({ column }) => <div className="text-center">{t('Editor.Table.ColumnActions')}</div>,
                cell: ({ row }) => {
                    const hasTranslation = row.original.target && row.original.target !== row.original.source;
                    return (
                        <div className="flex items-center justify-center gap-1">
                            {/* 人工标记：不需要翻译（与 AI 判定分离，重跑 AI 不清掉） */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className={row.original.ignored
                                    ? 'h-8 w-8 text-amber-600 hover:text-amber-700'
                                    : 'h-8 w-8 text-muted-foreground hover:text-amber-600'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    updateAstItems([{ id: row.original.id, updates: { ignored: !row.original.ignored } }]);
                                }}
                                title={row.original.ignored
                                    ? t('Editor.Actions.ClearIgnored', '取消标记')
                                    : t('Editor.Actions.MarkIgnored', '不需要翻译')}
                            >
                                {row.original.ignored ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onReset(row.original.id);
                                }}
                                title={t('Editor.Actions.Restore')}
                                disabled={!hasTranslation}
                            >
                                <RotateCcw className="h-3 w-3" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(row.original.id);
                                }}
                                title={t('Common.Actions.Delete')}
                                disabled={judging}
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    );
                },
            },
        );

        return cols;
    }, [onDelete, onReset, updateAstItem, updateAstItems, onRowClick, selectionEnabled, isAllSelected, isIndeterminate, onToggleSelectAll, onToggleRowSelect, selectedIds, onNeedSource, handleOpenContext, judging, t]);

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getRowId: (row) => String(row.id),
    });

    const { rows } = table.getRowModel();

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 50,
        overscan: 10,
    });

    // Auto-scroll to selected row
    React.useEffect(() => {
        if (editingId !== null) {
            const index = rows.findIndex(row => row.original.id === editingId);
            if (index !== -1) {
                virtualizer.scrollToIndex(index, { align: 'auto' });
            }
        }
    }, [editingId]);

    // Helper to determine cell classes（稳定引用）
    const getCellClass = useCallback((columnId: string) => {
        if (columnId === 'select') {
            return "w-[1%] whitespace-nowrap p-2";
        }
        if (columnId === 'type' || columnId === 'name') {
            return "w-[1%] whitespace-nowrap p-2";
        }
        if (columnId === 'actions' || columnId === 'locate') {
            return "w-[1%] whitespace-nowrap p-2";
        }
        // source & target 用相同百分比强制等宽
        return "w-[38%] p-2";
    }, []);

    // Check for empty data
    if (!data || data.length === 0) {
        return (
            <div ref={ref} className="rounded-md border h-full overflow-hidden flex flex-col">
                <ASTTableEmptyState />
            </div>
        );
    }

    const virtualRows = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
    const paddingBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

    return (
        <div ref={ref} className="rounded-md border h-full overflow-hidden flex flex-col">
            <div ref={parentRef} className="flex-1 h-full overflow-auto" style={{ willChange: 'transform' }}>
                <table className="w-full caption-bottom text-sm">
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead
                                            key={header.id}
                                            className={`${getCellClass(header.id)} sticky top-0 bg-background z-20 shadow-sm`}
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {paddingTop > 0 && (
                            <tr><td colSpan={columns.length} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>
                        )}
                        {virtualRows.map((virtualRow) => {
                            const row = rows[virtualRow.index];
                            return (
                                <MemoizedAstRow
                                    key={row.id}
                                    ref={virtualizer.measureElement}
                                    dataIndex={virtualRow.index}
                                    row={row}
                                    isSelected={row.original.id === editingId}
                                    onRowClick={onRowClick}
                                    getCellClass={getCellClass}
                                    errorType={errorMap.get(row.original.id) || null}
                                    isChecked={selectedIds?.has(row.original.id) || false}
                                    onToggleRowSelect={onToggleRowSelect}
                                />
                            );
                        })}
                        {paddingBottom > 0 && (
                            <tr><td colSpan={columns.length} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>
                        )}
                    </TableBody>
                </table>
            </div>
            <Dialog open={ctxOpen} onOpenChange={setCtxOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden select-text">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm">
                            <FileCode2 className="h-4 w-4" />
                            {contextItem?.line
                                ? t('Editor.Labels.SourceLine', { defaultValue: `行 ${contextItem.line}`, line: contextItem.line })
                                : t('Editor.Labels.SourceOffset', { defaultValue: '源码上下文' })}
                        </DialogTitle>
                    </DialogHeader>
                    {contextItem && (
                        <div className="min-h-0 overflow-y-auto">
                            <SourceContextView item={contextItem} code={sourceCode} isLoading={isLoadingSource} onOpenSource={onOpenSource} />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
});

ASTTable.displayName = 'ASTTable';
