// 导入依赖：UI组件、图标、Card子组件
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Button,
    ScrollArea,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuLabel,
    DropdownMenuSeparator
} from '@/src/shadcn';
import { useRegexStore } from '../../store';
import { isRegexItemKeptOnClearUntranslated } from '../../store/regex-slice';
import { RegexStatsCard } from '../..';
import { RegexInsertCard } from './regex-insert-card';
import { RegexLLMCard } from './regex-llm-card';
import { QuickActionsCard } from '../common/quick-actions-card';
import { DiagnoseCard } from '../common/diagnose-card';
import { useRegexTranslation } from './use-regex-translation';
import { Library, Settings2 } from 'lucide-react';
import { DiagnoseError } from '../../types';

interface Props {
    regexController?: ReturnType<typeof useRegexTranslation>;
    activeTab?: string;
    onTabChange?: (value: string) => void;
    onIncrementalExtract?: () => void;
    onOpenFile?: () => void;
    onDiagnose?: () => void;
    onClearDiagnose?: () => void;
    onRestoreAllErrors?: () => void;
    onUnusedDiagnose?: () => void;
    onDeleteUnused?: () => void;
    isDiagnosing?: boolean;
    isUnusedScan?: boolean;
    isSecurityScan?: boolean;
    isLogicScan?: boolean;
    onSecurityDiagnose?: () => void;
    onLogicDiagnose?: () => void;
    errorItems?: DiagnoseError[];
    hasChecked?: boolean;
    setActiveTab?: (tab: string) => void;
    isApplied?: boolean;
    onJumpError?: (error: DiagnoseError) => void;
    onAiFixError?: (error: DiagnoseError) => Promise<void>;
}

/**
 * RegexSidebar 容器组件：整合所有Card子组件
 */
const RegexSidebar: React.FC<Props> = ({
    regexController,
    activeTab,
    onTabChange,
    onIncrementalExtract,
    onOpenFile,
    onDiagnose,
    isDiagnosing,
    errorItems,
    hasChecked,
    setActiveTab,
    onClearDiagnose,
    onRestoreAllErrors,
    onUnusedDiagnose,
    onDeleteUnused,
    isUnusedScan,
    isSecurityScan,
    isLogicScan,
    onSecurityDiagnose,
    onLogicDiagnose,
    isApplied,
    onJumpError,
    onAiFixError
}) => {
    const { t } = useTranslation();

    // Lifted State (Received via props, fallback to local for safety)
    const localController = useRegexTranslation();
    const activeController = regexController || localController;

    // 视图过滤只是隐藏，但「清除未翻译」作用在数据上：被隐藏且未翻译的条目会被一并真实删除。
    // 这里算出该数量透传给按钮提示——方案是「不豁免，但明确告知」，避免静默删除。
    const regexItems = useRegexStore.use.regexItems();
    const hideAstCoveredRegex = useRegexStore.use.hideAstCoveredRegex();
    const astCoveredRegexSources = useRegexStore.use.astCoveredRegexSources();
    const clearUntranslatedHiddenCount = React.useMemo(() => {
        if (!hideAstCoveredRegex || astCoveredRegexSources.length === 0) return 0;
        const covered = new Set(astCoveredRegexSources);
        let count = 0;
        for (const item of regexItems) {
            if (covered.has(item.source) && !isRegexItemKeptOnClearUntranslated(item)) count++;
        }
        return count;
    }, [hideAstCoveredRegex, astCoveredRegexSources, regexItems]);

    // View State Management
    const [showStats, setShowStats] = useState(true);
    const [showInsert, setShowInsert] = useState(true);
    const [showQuickActions, setShowQuickActions] = useState(true);
    const [showLLM, setShowLLM] = useState(true);

    return (
        <div className="flex flex-col w-full h-full">
            {/* 固定标题栏 - 与左侧标题栏对齐 */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
                <div className="flex items-center text-sm font-semibold gap-1.5">
                    <Library className="w-4 h-4" />
                    <span>{t('Editor.Titles.Sidebar')}</span>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <Settings2 className="w-4 h-4" />
                            <span className="sr-only">{t('Editor.Labels.SidebarViewOptions')}</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>{t('Editor.Labels.SidebarShowCards')}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                            checked={showStats}
                            onCheckedChange={setShowStats}
                        >
                            {t('Editor.Stats.Title')}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={showInsert}
                            onCheckedChange={setShowInsert}
                        >
                            {t('Editor.Titles.Insert')}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={showQuickActions}
                            onCheckedChange={setShowQuickActions}
                        >
                            {t('Editor.Titles.QuickActions')}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={showLLM}
                            onCheckedChange={setShowLLM}
                        >
                            {t('Editor.Titles.Ai')}
                        </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* 可滚动的卡片区域 */}
            <ScrollArea className="flex-1 min-h-0 px-2 pb-2">
                <div className="space-y-4 pb-4">
                    {showStats && (
                        <RegexStatsCard />
                    )}

                    {showInsert && (
                        <RegexInsertCard />
                    )}

                    {showQuickActions && (
                        <QuickActionsCard
                            onIncrementalExtract={onIncrementalExtract || (() => { })}
                            onClearUntranslated={useRegexStore.use.deleteUntranslatedRegexItems()}
                            onOpenFile={onOpenFile}
                            isApplied={isApplied}
                            clearUntranslatedHiddenCount={clearUntranslatedHiddenCount}
                        />
                    )}
                    <DiagnoseCard
                        onDiagnose={onDiagnose!}
                        onUnusedDiagnose={onUnusedDiagnose}
                        onSecurityDiagnose={onSecurityDiagnose}
                        onLogicDiagnose={onLogicDiagnose}
                        onDeleteUnused={onDeleteUnused}
                        onClear={onClearDiagnose!}
                        onRestoreAllErrors={onRestoreAllErrors}
                        isDiagnosing={isDiagnosing!}
                        isUnusedScan={isUnusedScan}
                        isSecurityScan={isSecurityScan}
                        isLogicScan={isLogicScan}
                        errorItems={errorItems || []}
                        hasChecked={hasChecked}
                        setActiveTab={setActiveTab}
                        onJumpError={onJumpError}
                        onAiFixError={onAiFixError}
                    />
                    {showLLM && (
                        <RegexLLMCard controller={activeController} />
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};

export { RegexSidebar };