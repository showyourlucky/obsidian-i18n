import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 翻译记忆徽章：条目译文由翻译记忆自动回填（未消耗 AI 调用）。
 *
 * 仅为运行时标记（不随翻译源落盘）：重新打开编辑器后标记消失，但译文已写入条目。
 * 用户可直接修改译文或用「还原」重置，语义与人工译文完全一致。
 */
export const MemoryBadge = React.memo(() => {
    const { t } = useTranslation();
    return (
        <span
            title={t('Editor.Verdict.MemoryTip', '译文来自翻译记忆的自动回填，可继续修改或重置')}
            className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30"
        >
            {t('Editor.Verdict.Memory', '记忆')}
        </span>
    );
});
MemoryBadge.displayName = 'MemoryBadge';
