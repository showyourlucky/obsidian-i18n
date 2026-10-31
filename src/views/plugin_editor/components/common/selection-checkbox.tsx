import React, { useCallback } from 'react';
import { Checkbox } from '~/shadcn';

/** Shift / Ctrl(⌘) + 左键点击行时的修饰键状态 */
export interface RowSelectModifiers {
    shift: boolean;
    ctrl: boolean;
}

/**
 * 计算 Shift 范围选择要覆盖的 id（按当前可见顺序，含两端）。
 *
 * 锚点缺失或已被筛掉时返回 null，调用方应回退为「只选这一行」——
 * 否则会从错误的起点框选出一大段用户没预期的条目。
 */
export const getRangeSelectedIds = (
    orderedIds: number[],
    anchorId: number | null,
    targetId: number,
): number[] | null => {
    if (anchorId === null) return null;
    const anchorIndex = orderedIds.indexOf(anchorId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (anchorIndex === -1 || targetIndex === -1) return null;
    const [start, end] = anchorIndex <= targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
    return orderedIds.slice(start, end + 1);
};

/**
 * 行点击（带修饰键）后的选择结果，AST / Regex 两个表格共用同一套语义：
 * - 普通点击由调用方处理（预览/定位），不经过这里
 * - Ctrl(⌘)：在已有选择上切换单行
 * - Shift：从锚点到当前行重新框选
 * - Ctrl+Shift：在已有选择上追加这一段范围
 */
export const computeRowClickSelection = (
    current: number[],
    orderedIds: number[],
    anchorId: number | null,
    targetId: number,
    modifiers: RowSelectModifiers,
): { ids: number[]; anchorId: number } => {
    if (modifiers.shift) {
        const range = getRangeSelectedIds(orderedIds, anchorId, targetId);
        const base = modifiers.ctrl ? current : [];
        return {
            ids: Array.from(new Set([...base, ...(range ?? [targetId])])),
            // 锚点失效（首次即 Shift 点击 / 原锚点被筛掉）时以当前行重建
            anchorId: anchorId !== null && orderedIds.includes(anchorId) ? anchorId : targetId,
        };
    }
    const next = new Set(current);
    if (next.has(targetId)) next.delete(targetId);
    else next.add(targetId);
    return { ids: Array.from(next), anchorId: targetId };
};

/**
 * 表格多选的行复选框。
 *
 * 独立 memo 组件 + 阻止冒泡：点击复选框不能触发行点击（AST 行会打开上下文预览、
 * Regex 行的输入框会进入编辑态）。
 *
 * AST 表格与 Regex 表格共用同一实现，避免两份样式与交互漂移。
 */
export const RowCheckbox = React.memo(({
    id,
    checked,
    onToggle,
}: {
    id: number,
    checked: boolean,
    onToggle: (id: number, checked: boolean) => void,
}) => {
    const handleChange = useCallback((c: boolean) => {
        onToggle(id, c);
    }, [id, onToggle]);

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    return (
        <div className="flex items-center justify-center" onClick={handleClick}>
            <Checkbox
                checked={checked}
                onCheckedChange={handleChange}
                aria-label="select row"
            />
        </div>
    );
});
RowCheckbox.displayName = 'RowCheckbox';

/** 表头全选复选框（支持半选态） */
export const HeaderCheckbox = React.memo(({
    checked,
    indeterminate,
    onToggle,
}: {
    checked: boolean,
    indeterminate: boolean,
    onToggle: (checked: boolean) => void,
}) => {
    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    return (
        <div className="flex items-center justify-center" onClick={handleClick}>
            <Checkbox
                checked={indeterminate ? 'indeterminate' : checked}
                onCheckedChange={(c) => onToggle(!!c)}
                aria-label="select all"
            />
        </div>
    );
});
HeaderCheckbox.displayName = 'HeaderCheckbox';
