import React, { useCallback } from 'react';
import { Checkbox } from '~/shadcn';

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
