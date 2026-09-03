import { useState, useRef, useEffect } from 'react';
import { useRegexStore } from '../../store';
import { createTranslationProvider } from '~/ai/provider-factory';
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import { JudgeItem } from '~/ai/provider-types';
import { AstItem } from '../../types';
import { buildJudgeSnippet, createSourceContextCache } from '@/src/utils/common/source-context';
import { EDITOR_EVENTS } from '../../events';

/**
 * 读取当前文件的源码 (内存缓存)
 * 用 getState() 在调用时取最新值，避免订阅导致的额外重渲染
 */
const readSourceCode = (): string => {
    const { sourceCache, currentFile } = useRegexStore.getState();
    return (currentFile && sourceCache?.[currentFile]?.code) || '';
};

/**
 * 确保判定时源码可用。
 *
 * 用户可能在未打开过「上下文预览」弹窗的情况下直接判定，此时缓存为空、
 * 无法生成 snippet。这里按需触发主编辑器读盘 (静默)，完成后回读缓存；
 * 超时兜底避免判定被永久挂起 (无源码时退化为不带上下文，功能仍可用)。
 */
const ensureSourceCode = (timeoutMs = 8000): Promise<string> => {
    const cached = readSourceCode();
    if (cached) return Promise.resolve(cached);

    return new Promise<string>((resolve) => {
        let timer: any = null;
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener(EDITOR_EVENTS.SourceLoaded, finish);
            resolve(readSourceCode());
        };
        timer = setTimeout(finish, timeoutMs);
        window.addEventListener(EDITOR_EVENTS.SourceLoaded, finish);
        window.dispatchEvent(new CustomEvent(EDITOR_EVENTS.LoadSource));
    });
};

export const useAstJudge = () => {
    const updateAstItems = useRegexStore.use.updateAstItems();
    const { t } = useTranslation();

    const [isJudging, setIsJudging] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    // 组件卸载时中止进行中的判定，避免视图关闭后仍继续写 store、弹 toast
    useEffect(() => () => {
        abortControllerRef.current?.abort();
    }, []);

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsJudging(false);
            toast.info(t('Common.Notices.TaskStopped'));
        }
    };

    /**
     * 对选中条目调用 LLM 判定是否需要翻译，结果仅写入元数据 (aiVerdict/aiReason/aiConfidence)，不修改 source/target
     */
    const judge = async (items: AstItem[]) => {
        if (isJudging || items.length === 0) return;

        setIsJudging(true);
        setProcessedCount(0);
        setTotalCount(items.length);
        setProgress(0);
        // 本地持有 controller 引用：handleStop 会把 ref 置 null，
        // catch/finally 中若依赖 ref 将无法识别「手动取消」
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // 判定期间文件可能被切换或重新提取：store 会以 id 重建条目，
        // 回写前必须校验 id 仍指向判定开始时的同一条目，否则结果会错位到其他行
        const { currentFile: fileAtStart } = useRegexStore.getState();
        const sourceById = new Map(items.map(it => [it.id, it.source]));

        try {
            // 附带源码上下文 (snippet) 可显著提升判定准确度：
            // 无源码时退化为仅凭 type/name/propKey/argIndex 判断
            const code = await ensureSourceCode();
            const ctxCache = createSourceContextCache(code);
            const op = createTranslationProvider();
            const judgeItems: JudgeItem[] = items.map(it => ({
                id: it.id,
                source: it.source,
                type: it.type,
                name: it.name,
                propKey: it.propKey,
                argIndex: it.argIndex,
                snippet: buildJudgeSnippet(ctxCache, it),
                verdict: it.aiVerdict ?? 'unjudged',
            }));

            // 统计真正收到模型回调的条目：含合法的 unjudged（模型「不敢判定」也是有效结论）；
            // 仅从未收到回调（批次失败/超时）的条目才计入 failedCount，避免把合法 unjudged 误算成失败
            let reportedCount = 0;
            // 文件切换中止只提示一次（并发批次可能同时完成回调）
            let switched = false;

            await op.judgeTranslatable(
                judgeItems,
                async (batchResult, completed, total) => {
                    // 文件已切换：剩余判定结果无处安放，中止以节省开销
                    if (!switched && useRegexStore.getState().currentFile !== fileAtStart) {
                        switched = true;
                        controller.abort();
                        toast.info(t('Editor.Notices.JudgeAborted', { defaultValue: '文件已切换，AI 判定已中止' }));
                        return;
                    }
                    if (switched) return;

                    setProcessedCount(prev => prev + batchResult.length);
                    setProgress(total > 0 ? Math.round((completed / total) * 100) : 100);
                    reportedCount += batchResult.length;
                    // 条目被重新提取/替换时 id 指向已变化（source 不一致），丢弃该条回写
                    const currentItems = useRegexStore.getState().astItems;
                    const updates = batchResult
                        .filter(res => {
                            const cur = currentItems.find(x => x.id === res.id);
                            return cur != null && cur.source === sourceById.get(res.id);
                        })
                        .map(res => ({
                            id: res.id,
                            updates: {
                                aiVerdict: res.verdict,
                                aiReason: res.reason,
                                aiConfidence: res.confidence,
                            } as Partial<AstItem>,
                        }));
                    if (updates.length > 0) updateAstItems(updates);
                },
                controller.signal
            );

            // 部分批次失败时 (超时或返回格式异常) 必须明确告知，否则会出现「看似成功、实则未判定」
            const failedCount = items.length - reportedCount;
            if (failedCount > 0) {
                toast.warning(t('Editor.Notices.JudgePartialFail', {
                    success: reportedCount,
                    failed: failedCount,
                    defaultValue: `已判定 ${reportedCount} 项，${failedCount} 项未出结论（多为请求超时或返回格式异常，建议调大超时、减小每批数量或更换模型）`
                }));
            } else {
                toast.success(t('Editor.Actions.JudgeSuccess', { count: items.length, defaultValue: `已判定 ${items.length} 项` }));
            }
        } catch (error) {
            // 取消识别用本地 controller 的 aborted 状态判断，
            // 不依赖与本地化文案的字符串等值比较（多语言下会失效）
            if (controller.signal.aborted || (error as Error).name === 'AbortError') {
                // 手动取消/切换中止，已在对应入口提示
            } else {
                console.error('Judge failed', error);
                toast.error(t('Common.Notices.TranslateFail', { message: (error as Error).message }));
            }
        } finally {
            // 仅当 ref 仍指向本次 controller 时才复位，避免旧任务的收尾清掉新任务的状态
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
                setIsJudging(false);
            }
        }
    };

    return {
        state: { isJudging, progress, processedCount, totalCount },
        actions: { judge, handleStop }
    };
};
