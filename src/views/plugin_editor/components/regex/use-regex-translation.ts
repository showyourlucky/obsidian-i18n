import { useState, useEffect, useRef, useMemo } from 'react';
import { useRegexStore } from '../../store';
import { useGlobalStore } from '~/utils';
import { createTranslationProvider } from '@/src/ai/provider-factory';
import { toast } from "sonner";
import { t } from "@/src/locales";
import { STYLES } from '@/src/constants/llm-options';
import { SUPPORTED_LANGUAGES } from '@/src/constants/languages';
import { selectPendingItems } from '~/utils/translator/pending-items';


export const useRegexTranslation = () => {
    const regexItems = useRegexStore.use.regexItems();
    const updateRegexItems = useRegexStore.use.updateRegexItems();
    const selectedRegexIds = useRegexStore.use.selectedRegexIds();
    const i18n = useGlobalStore.use.i18n();

    // Local State
    const [language, setLanguage] = useState(i18n.settings.language || i18n.settings.llmLanguage || 'zh-cn');
    const [style, setStyle] = useState(i18n.settings.llmStyle);
    const [batchSize, setBatchSize] = useState(i18n.settings.llmBatchSize?.toString() || '20');
    const [concurrencyLimit, setConcurrencyLimit] = useState(i18n.settings.llmConcurrencyLimit?.toString() || '3');
    const [overwrite, setOverwrite] = useState(false);
    // 限制本次翻译的批次数，0/空 表示不限制，只翻译前 N 批
    const [maxBatches, setMaxBatches] = useState('');
    const [maxBatchesError, setMaxBatchesError] = useState(false);

    const [inputError, setInputError] = useState(false);
    const [concurrencyError, setConcurrencyError] = useState(false);
    const [timeout, setTimeoutVal] = useState(i18n.settings.llmTimeout?.toString() || '60000');
    const [timeoutError, setTimeoutError] = useState(false);


    // Translation State
    const [isTranslating, setIsTranslating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [currentBatch, setCurrentBatch] = useState(0);
    const [totalBatches, setTotalBatches] = useState(0);

    const abortControllerRef = useRef<AbortController | null>(null);

    // Computed State
    //
    // 口径统一在 selectPendingItems：人工标记「不需要翻译」的条目永远不参与批量翻译。
    // 表格有选中项时只翻选中的；未选中时翻全部待翻译条目。
    // 注意「隐藏 AST 已覆盖」只是视图过滤，不影响翻译范围——要排除它们请用多选。
    // 待翻译计数 / token 估算 / 费用估算 / 进度总数都派生自 targetItems，随之自动保持一致。
    const selectedIdSet = useMemo(() => new Set(selectedRegexIds), [selectedRegexIds]);
    const targetItems = useMemo(() => {
        const pending = selectPendingItems(regexItems, { overwrite });
        if (selectedIdSet.size === 0) return pending;
        return pending.filter(item => selectedIdSet.has(item.id));
    }, [regexItems, overwrite, selectedIdSet]);

    // Sync from Global Settings
    useEffect(() => {
        setLanguage(i18n.settings.language || i18n.settings.llmLanguage || 'zh-cn');
        setStyle(i18n.settings.llmStyle);
        setBatchSize(i18n.settings.llmBatchSize?.toString() || '20');
        setConcurrencyLimit(i18n.settings.llmConcurrencyLimit?.toString() || '3');
        setTimeoutVal(i18n.settings.llmTimeout?.toString() || '60000');
    }, [i18n.settings.language, i18n.settings.llmLanguage, i18n.settings.llmStyle, i18n.settings.llmBatchSize, i18n.settings.llmConcurrencyLimit, i18n.settings.llmTimeout]);


    // Handlers
    const saveSettings = (updates: Partial<typeof i18n.settings>) => {
        Object.assign(i18n.settings, updates);
        i18n.saveSettings();
    }

    const handleLanguageChange = (value: string) => {
        setLanguage(value);
        saveSettings({ language: value, llmLanguage: value });
    }

    const handleStyleChange = (value: string) => {
        setStyle(value);
        saveSettings({ llmStyle: value });
    }

    const handleBatchSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setBatchSize(val);

        const size = parseInt(val, 10);
        if (isNaN(size) || size <= 0) {
            setInputError(true);
        } else {
            setInputError(false);
        }
    }

    const handleBatchSizeBlur = () => {
        const size = parseInt(batchSize, 10);
        if (!isNaN(size) && size > 0) {
            saveSettings({ llmBatchSize: size });
            setInputError(false);
        } else {
            setBatchSize(i18n.settings.llmBatchSize?.toString() || '20');
            setInputError(false);
        }
    }

    const handleConcurrencyLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setConcurrencyLimit(val);

        const limit = parseInt(val, 10);
        if (isNaN(limit) || limit <= 0) {
            setConcurrencyError(true);
        } else {
            setConcurrencyError(false);
        }
    }

    const handleConcurrencyLimitBlur = () => {
        const limit = parseInt(concurrencyLimit, 10);
        if (!isNaN(limit) && limit > 0) {
            saveSettings({ llmConcurrencyLimit: limit });
            setConcurrencyError(false);
        } else {
            setConcurrencyLimit(i18n.settings.llmConcurrencyLimit?.toString() || '3');
            setConcurrencyError(false);
        }
    }

    const handleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setTimeoutVal(val);

        const ms = parseInt(val, 10);
        if (isNaN(ms) || ms <= 0) {
            setTimeoutError(true);
        } else {
            setTimeoutError(false);
        }
    }

    const handleTimeoutBlur = () => {
        const ms = parseInt(timeout, 10);
        if (!isNaN(ms) && ms > 0) {
            saveSettings({ llmTimeout: ms });
            setTimeoutError(false);
        } else {
            setTimeoutVal(i18n.settings.llmTimeout?.toString() || '60000');
            setTimeoutError(false);
        }
    }

    const handleMaxBatchesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setMaxBatches(val);
        if (val.trim() === '') {
            setMaxBatchesError(false);
            return;
        }
        const n = parseInt(val, 10);
        setMaxBatchesError(isNaN(n) || n < 0);
    };


    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsTranslating(false);
            toast.info(t('Common.Notices.TaskStopped'));
        }
    };

    const handleBatchTranslation = async () => {
        if (isTranslating) return;

        if (targetItems.length === 0) {
            toast.info(t('Common.Notices.NoItemsToTranslate'));
            return;
        }

        setIsTranslating(true);
        setProcessedCount(0);
        setTotalCount(targetItems.length);
        setProgress(0);
        setCurrentBatch(0);
        setTotalBatches(1);

        abortControllerRef.current = new AbortController();

        try {


            const op = createTranslationProvider();
            const parsedMaxBatches = parseInt(maxBatches, 10);
            const limit = (!isNaN(parsedMaxBatches) && parsedMaxBatches > 0) ? parsedMaxBatches : undefined;
            await op.regexTranslate(
                targetItems,
                async (batchResult, batchIndex, totalBatchesVal) => {
                    // Update Progress
                    const currentProcessed = Math.min(Math.round((batchIndex / totalBatchesVal) * targetItems.length), targetItems.length);
                    setProcessedCount(currentProcessed);
                    setProgress((batchIndex / totalBatchesVal) * 100);
                    setCurrentBatch(batchIndex);
                    setTotalBatches(totalBatchesVal);

                    // Batch Update Store
                    const updates = batchResult.map(res => ({
                        id: res.id,
                        updates: { target: res.target }
                    }));
                    updateRegexItems(updates);
                },
                abortControllerRef.current.signal,
                limit
            );

            toast.success(t('Common.Notices.BatchTranslateSuccess'));

        } catch (error) {
            if ((error as Error).name === 'AbortError' || (error as Error).message === t('Common.Notices.TaskCancelled') || abortControllerRef.current?.signal.aborted) {
                // Handled in finally/stop
            } else {
                console.error("Batch translation failed", error);
                toast.error(t('Common.Notices.TranslateFail', { message: (error as Error).message }));
            }
        } finally {
            if (abortControllerRef.current) {
                setIsTranslating(false);
                abortControllerRef.current = null;
            }
        }
    }

    return {
        state: {
            language,
            style,
            batchSize,
            concurrencyLimit,
            overwrite,
            maxBatches,
            maxBatchesError,

            inputError,
            concurrencyError,
            isTranslating,
            progress,
            processedCount,
            totalCount,
            currentBatch,
            totalBatches,
            targetItems,
            /** 是否处于「仅翻译选中」模式（决定按钮文案与范围） */
            isSelectionMode: selectedIdSet.size > 0,
            timeout,
            timeoutError,
            get estimation() {
                const op = createTranslationProvider();
                return op.estimateTokens(targetItems, 'regex');
            }
        },
        actions: {
            setLanguage: handleLanguageChange,
            setStyle: handleStyleChange,
            setBatchSize: handleBatchSizeChange,
            setConcurrencyLimit: handleConcurrencyLimitChange,
            setOverwrite,
            setMaxBatches: handleMaxBatchesChange,

            handleTimeoutChange,
            handleBatchSizeBlur,
            handleConcurrencyLimitBlur,
            handleTimeoutBlur,
            handleBatchTranslation,
            handleStop
        }

    };
};
