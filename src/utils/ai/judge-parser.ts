/**
 * 解析 LLM 返回的判定结果 (JSON 数组，含 i/verdict/reason/confidence)
 *
 * 解析失败或结果为空时抛错（而非返回空数组），交由 Provider 的重试机制接管；
 * 静默返回空会导致该批次「看似成功、实则全部 unjudged」。
 *
 * 纯函数、无副作用，便于单元测试。
 */
import type { AiVerdict } from '../../types/plugin';

export interface JudgeParsedItem {
    i: number;
    verdict: AiVerdict;
    reason?: string;
    confidence?: number;
}

export function parseJudgeResponse(content: string): JudgeParsedItem[] {
    let text = content.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();

    let arr: any[];
    try {
        const data = JSON.parse(text);
        arr = Array.isArray(data) ? data : (data.items || data.results || []);
    } catch (e) {
        console.error('Failed to parse judge response', e);
        throw new Error('AI 判定结果解析失败（返回格式异常）');
    }
    const cleaned = arr
        .filter((x: any) => Number.isFinite(Number(x?.i)))
        .map((x: any) => ({
            i: Number(x.i),
            verdict: (['translatable', 'untranslatable', 'unjudged'].includes(x.verdict) ? x.verdict : 'unjudged') as AiVerdict,
            reason: typeof x.reason === 'string' ? x.reason : undefined,
            confidence: typeof x.confidence === 'number' ? x.confidence : undefined,
        }));
    // 过滤后为空同样抛错：模型若返回的条目全部缺 i，返回空数组会让该批次
    // 「看似成功、实则全部 unjudged」，与注释声明的「解析失败交由重试接管」意图不符
    if (cleaned.length === 0) {
        throw new Error('AI 判定结果为空（模型未返回任何结论）');
    }
    return cleaned;
}
