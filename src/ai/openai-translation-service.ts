
import { requestUrl } from "obsidian";
import OpenAI from "openai";
import { normalizeOpenAIUrl } from "../utils/ai/url-helper";
import { RegexItem, AstItem } from "../views/plugin_editor/types";
import { JudgeItem } from "./provider-types";
import { AiVerdict } from "../types";
import { ThemeTranslationItem } from "../views/theme_editor/types";
import { useGlobalStoreInstance } from "~/utils";
import { BaseProvider } from "./base-provider";
import { LLM_PROVIDERS } from "./constants";

// 自定义消息类型
interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export class OpenAITranslationService extends BaseProvider {

    constructor() {
        super();
    }

    /**
     * 获取 OpenAI 实例 (动态获取最新配置)
     */
    private getOpenAIClient(): OpenAI {
        const settings = useGlobalStoreInstance.getState().i18n.settings;
        const activeProfile = this.getActiveProfile();

        if (!activeProfile) {
            throw new Error("Missing active profile for the selected provider.");
        }

        const apiKey = activeProfile.key;
        const rawUrl = normalizeOpenAIUrl(activeProfile.url || LLM_PROVIDERS[settings.llmApi]?.baseUrl || "");
        const baseURL = rawUrl || undefined;

        return new OpenAI({
            baseURL: baseURL,
            apiKey: apiKey,
            dangerouslyAllowBrowser: true,
            fetch: async (url, options) => {
                // ... (Headers handling remains same)
                const headers: Record<string, string> = {};
                if (options?.headers) {
                    if (options.headers instanceof Headers) {
                        options.headers.forEach((value, key) => { headers[key] = value; });
                    } else if (Array.isArray(options.headers)) {
                        options.headers.forEach(([key, value]) => { headers[key] = value; });
                    } else {
                        Object.assign(headers, options.headers as Record<string, string>);
                    }
                }

                const signal = options?.signal;
                return new Promise((resolve, reject) => {
                    const onAbort = () => reject(new Error('AbortError'));
                    if (signal?.aborted) return onAbort();
                    signal?.addEventListener('abort', onAbort);

                    requestUrl({
                        url: url.toString(),
                        method: options?.method || 'POST',
                        headers: headers,
                        body: options?.body as string,
                        throw: false
                    }).then(response => {
                        signal?.removeEventListener('abort', onAbort);
                        resolve({
                            ok: response.status >= 200 && response.status < 300,
                            status: response.status,
                            statusText: response.status.toString(),
                            headers: new Headers(response.headers as any),
                            json: () => Promise.resolve(response.json),
                            text: () => Promise.resolve(response.text),
                            arrayBuffer: () => Promise.resolve(response.arrayBuffer),
                        } as Response);
                    }).catch(err => {
                        signal?.removeEventListener('abort', onAbort);
                        reject(err);
                    });
                });
            }
        });
    }

    /** 覆写：返回当前服务对应的模型名 */
    protected override getModelName(): string {
        const activeProfile = this.getActiveProfile();
        if (activeProfile?.model) return activeProfile.model;

        const settings = useGlobalStoreInstance.getState().i18n.settings;
        const config = LLM_PROVIDERS[settings.llmApi];
        if (config) {
            return config.defaultModel;
        }
        return 'gpt-4o-mini';
    }

    /**
     * Regex 专用 API 调用
     */
    protected async callRegexTranslationAPI(items: RegexItem[], signal?: AbortSignal): Promise<RegexItem[]> {
        const systemPrompt = this.getRegexSystemPrompt();
        const simplifiedItems = items.map(item => ({ i: item.id, s: item.source }));
        const simplifiedResults = await this.callOpenAI(simplifiedItems, systemPrompt, signal);
        return this.mapResultsBack(items, simplifiedResults);
    }

    /**
     * AST 专用 API 调用
     */
    protected async callAstTranslationAPI(items: AstItem[], signal?: AbortSignal): Promise<AstItem[]> {
        const systemPrompt = this.getAstSystemPrompt();
        const simplifiedItems = items.map(item => ({ i: item.id, s: item.source, y: item.type, n: item.name }));
        const simplifiedResults = await this.callOpenAI(simplifiedItems, systemPrompt, signal);
        return this.mapResultsBack(items, simplifiedResults);
    }

    /**
     * Theme 专用 API 调用
     */
    protected async callThemeTranslationAPI(items: ThemeTranslationItem[], signal?: AbortSignal): Promise<ThemeTranslationItem[]> {
        const systemPrompt = this.getThemeSystemPrompt();
        const simplifiedItems = items.map(item => ({ i: (item as any).id, s: item.source, y: item.type }));
        const simplifiedResults = await this.callOpenAI(simplifiedItems, systemPrompt, signal);
        return this.mapResultsBack(items as any[], simplifiedResults) as unknown as ThemeTranslationItem[];
    }


    /**
     * 统一的 OpenAI 调用逻辑
     */
    private async callOpenAI(items: any[], systemPrompt: string, signal?: AbortSignal, maxRetries = 2, schemaKind: 'translate' | 'judge' = 'translate', parseFn?: (content: string) => any[]): Promise<any[]> {
        const settings = useGlobalStoreInstance.getState().i18n.settings;
        const messages: ChatMessage[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(items) },
        ];

        let attempt = 0;
        let lastError: any = null;

        while (attempt <= maxRetries) {
            const timeoutController = new AbortController();
            const timeoutMs = settings.llmTimeout || 60000;
            const timeoutId = setTimeout(() => {
                timeoutController.abort();
            }, timeoutMs);

            const abortHandler = () => timeoutController.abort();
            if (signal) {
                signal.addEventListener('abort', abortHandler);
            }

            try {
                if (signal?.aborted) throw new Error('翻译任务已取消');

                const requestParams: any = {
                    messages: messages as any,
                    model: this.getModelName(),
                    temperature: 0.3,
                };

                // 根据设定的格式注入对应 response_format
                // judge 模式结构固定，强制使用 json_schema strict：
                // 避免用户设为 json_object（顶层必须是对象）与提示词「返回 JSON 数组」冲突导致解析失败
                const forceSchema = schemaKind === 'judge';
                if (settings.llmResponseFormat === 'json_schema' || forceSchema) {
                    const schema = schemaKind === 'judge'
                        ? {
                            type: "object",
                            properties: {
                                items: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            i: { type: "number" },
                                            verdict: { type: "string", enum: ["translatable", "untranslatable", "unjudged"] },
                                            // strict 模式要求 properties 中每个键都必须列入 required，
                                            // 可选语义用可空联合类型表达，否则 API 直接返回 400
                                            reason: { type: ["string", "null"] },
                                            confidence: { type: ["number", "null"] }
                                        },
                                        required: ["i", "verdict", "reason", "confidence"],
                                        additionalProperties: false
                                    }
                                }
                            },
                            required: ["items"],
                            additionalProperties: false
                        }
                        : {
                            type: "object",
                            properties: {
                                items: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: { i: { type: "number" }, t: { type: "string" } },
                                        required: ["i", "t"],
                                        additionalProperties: false
                                    }
                                }
                            },
                            required: ["items"],
                            additionalProperties: false
                        };
                    requestParams.response_format = {
                        type: 'json_schema',
                        json_schema: {
                            name: schemaKind === 'judge' ? "judge_result" : "translation_result",
                            schema,
                            strict: true
                        }
                    };
                }

                const openai = this.getOpenAIClient();
                const completion = await openai.chat.completions.create(requestParams, { signal: timeoutController.signal });

                const assistantContent = completion.choices[0].message.content;
                return parseFn ? parseFn(assistantContent || '') : this.parseResponseContent(assistantContent || '');
            } catch (error: any) {
                // 检查是否是因为超时导致的取消
                const isTimeout = error.name === 'AbortError' && !signal?.aborted;
                const isManualAbort = signal?.aborted || error.message === '翻译任务已取消';

                if (isManualAbort) {
                    throw new Error('翻译任务已取消');
                }

                // Judge 模式超时不重试：超时多因单批过大或模型过慢，
                // 重试只会再等满一个完整超时周期且大概率再超时，直接上抛按批次失败处理
                if (isTimeout && schemaKind === 'judge') {
                    throw new Error(this.buildTimeoutMessage(timeoutMs));
                }

                lastError = isTimeout ? new Error(this.buildTimeoutMessage(timeoutMs)) : error;
                attempt++;

                if (attempt <= maxRetries) {
                    console.warn(`[OpenAI API] ${isTimeout ? '请求超时' : '调用失败'}，正在尝试第 ${attempt} 次重试...`, lastError.message);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            } finally {
                // 清理资源
                clearTimeout(timeoutId);
                if (signal) {
                    signal.removeEventListener('abort', abortHandler);
                }
            }
        }

        const errorMsg = lastError ? (lastError as Error).message : '未知错误';
        console.error(`[OpenAI API] 批次翻译API调用最终失败:`, errorMsg, `\n请求数据：${JSON.stringify(items)}`);

        // 抛出错误，交由上层的 executeParallelBatches 统一捕获并执行界面提醒
        throw new Error(errorMsg);
    }

    /**
     * Fix API 调用 — 修复单条翻译
     */
    protected override async callFixAPI(
        source: string,
        target: string,
        errorMessage: string,
        systemPrompt: string,
        signal?: AbortSignal
    ): Promise<string> {
        const settings = useGlobalStoreInstance.getState().i18n.settings;
        const userContent = [
            `Source: ${source}`,
            `Broken Translation: ${target}`,
            `Error: ${errorMessage}`,
            '',
            'Please return ONLY the fixed translation string.'
        ].join('\n');

        const messages: ChatMessage[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
        ];

        const timeoutController = new AbortController();
        const timeoutMs = settings.llmTimeout || 60000;
        const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

        const abortHandler = () => timeoutController.abort();
        if (signal) signal.addEventListener('abort', abortHandler);

        try {
            if (signal?.aborted) throw new Error('修复任务已取消');

            const openai = this.getOpenAIClient();
            const completion = await openai.chat.completions.create({
                messages: messages as any,
                model: this.getModelName(),
                temperature: 0.2,
            }, { signal: timeoutController.signal });

            const result = completion.choices[0].message.content;
            if (!result || result.trim() === '') {
                throw new Error('AI 返回的修复结果为空');
            }

            // 清理可能的 markdown 包裹
            let cleaned = result.trim();
            if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                cleaned = cleaned.slice(1, -1);
            }
            if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
                cleaned = cleaned.slice(1, -1);
            }

            return cleaned;
        } finally {
            clearTimeout(timeoutId);
            if (signal) signal.removeEventListener('abort', abortHandler);
        }
    }

    public supportsJudge(): boolean {
        return true;
    }

    /** Judge API — AI 判定 AST 条目是否需要翻译 */
    protected async callJudgeAPI(items: JudgeItem[], signal?: AbortSignal): Promise<JudgeItem[]> {
        const systemPrompt = this.getJudgeSystemPrompt();
        const simplified = items.map(it => ({
            i: it.id, s: it.source,
            y: it.type ?? null, n: it.name ?? null,
            k: it.propKey ?? null, a: it.argIndex ?? null, c: it.snippet ?? null,
        }));
        const verdicts = await this.callOpenAI(simplified, systemPrompt, signal, 2, 'judge', (c) => this.parseJudgeResponse(c)) as Array<{ i: number; verdict: AiVerdict; reason?: string; confidence?: number }>;
        return items.map(it => {
            const v = verdicts.find(x => x.i === it.id);
            return { ...it, verdict: v?.verdict ?? 'unjudged', reason: v?.reason, confidence: v?.confidence };
        });
    }
}









