import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 人工标记徽章：条目已被用户标记为「不需要翻译」。
 *
 * 与 AI 判定的 `untranslatable` 语义分离——重跑 AI 判定不会清掉该标记；
 * 再次提取时可通过「隐藏已忽略」筛选快速筛掉这些条目。
 */
export const IgnoredBadge = React.memo(() => {
    const { t } = useTranslation();
    return (
        <span
            title={t('Editor.Verdict.IgnoredTip', '已标记为不需要翻译，待手动删除；标记错了可在「只看待删」中重置')}
            className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
        >
            {t('Editor.Verdict.Ignored', '待删')}
        </span>
    );
});
IgnoredBadge.displayName = 'IgnoredBadge';
