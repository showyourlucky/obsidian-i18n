import React, { memo } from 'react';
import { Button } from '@/src/shadcn';
import { FileOutput, Trash2, Loader2, Zap, FileEdit } from 'lucide-react';
import { TemplateCard } from './template-card';
import { useTranslation } from 'react-i18next';

interface QuickActionsCardProps {
    onIncrementalExtract: () => void;
    onClearUntranslated: () => void;
    onOpenFile?: () => void;
    isExtracting?: boolean;
    isApplied?: boolean;
    /**
     * 当前因「隐藏 AST 已覆盖项」而未显示、但会被「清除未翻译」一并真实删除的条目数。
     *
     * 视图过滤本身只是隐藏，而批量清理作用在数据上：被隐藏的条目多为「未翻译」，
     * 恰好命中清除条件。传入 > 0 时在按钮提示里明确告知，避免被静默删除。仅正则侧使用。
     */
    clearUntranslatedHiddenCount?: number;
}

const QuickActionsCard: React.FC<QuickActionsCardProps> = memo(({
    onIncrementalExtract,
    onClearUntranslated,
    onOpenFile,
    isExtracting,
    isApplied,
    clearUntranslatedHiddenCount
}) => {
    const { t } = useTranslation();

    return (
        <TemplateCard
            title={t('Editor.Titles.QuickActions')}
            icon={Zap}
            className="flex flex-col gap-2"
        >
            <div className="flex flex-col gap-2">
                {onOpenFile && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onOpenFile}
                        title={t('Editor.Actions.OpenFileTip')}
                        className="text-xs h-8 gap-1.5 text-foreground transition-all duration-200 hover:scale-[1.01] active:scale-95 group w-full font-medium bg-green-500/10 hover:bg-green-500/20 border-green-500/20"
                    >
                        <FileEdit className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                        {t('Editor.Actions.OpenFile')}
                    </Button>
                )}

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onIncrementalExtract}
                    disabled={isExtracting || isApplied}
                    title={isApplied ? t('Editor.Actions.IncrementalExtractDisabledTip') : t('Editor.Actions.IncrementalExtractTip')}
                    className="text-xs h-8 gap-1.5 text-foreground transition-all duration-200 hover:scale-[1.01] active:scale-95 group w-full font-medium bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20"
                >
                    {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileOutput className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                    {t('Editor.Actions.IncrementalExtract')}
                </Button>

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onClearUntranslated}
                    title={clearUntranslatedHiddenCount && clearUntranslatedHiddenCount > 0
                        ? t('Editor.Actions.DeleteUntranslatedHiddenTip', {
                            count: clearUntranslatedHiddenCount,
                            defaultValue: '将一并删除 {{count}} 条当前被隐藏、不会生效的条目'
                        })
                        : t('Editor.Actions.DeleteUntranslatedTip')}
                    className="text-xs h-8 gap-1.5 text-red-600 dark:text-red-400 transition-all duration-200 hover:scale-[1.01] active:scale-95 group w-full font-medium bg-red-500/10 hover:bg-red-500/20 border-red-500/20"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('Editor.Actions.DeleteUntranslated')}
                </Button>
            </div>
        </TemplateCard>
    );
});

QuickActionsCard.displayName = 'QuickActionsCard';

export { QuickActionsCard };
