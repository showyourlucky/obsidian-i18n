/**
 * Ollama 本地模型翻译 Provider
 * 
 * 复用 OpenAI 兼容协议（Ollama 原生支持 /v1/chat/completions）。
 * 主要区别：
 * - 预设默认端点 http://localhost:11434
 * - 无需 API Key
 * - 支持从 Ollama 获取已安装模型列表
 */

import { requestUrl } from "obsidian";
import { RegexItem, AstItem } from "../views/plugin_editor/types";
import { JudgeItem } from "./provider-types";
import { AiVerdict } from "../types";
import { ThemeTranslationItem } from "../views/theme_editor/types";
import { useGlobalStoreInstance } from "~/utils";
import { BaseProvider } from "./base-provider";

/** Ollama 默认端点 */
export const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

export class OllamaTranslationService extends BaseProvider {

    constructor() {
        super();
    }

    /** 覆写：返回当前 Ollama 模型名 */
    protected override getModelName(): string {
        const activeProfile = this.getActiveProfile();
        return activeProfile?.model || 'qwen2.5';
    }

    /** 获取 Ollama 端点地址 */
    private getBaseUrl(): string {
        const activeProfile = this.getActiveProfile();
        const url = activeProfile?.url || OLLAMA_DEFAULT_URL;
        return url.replace(/\/+$/, '');
    }

    // ======================== 核心 API 调用 ========================

    /**
     * 调用 Ollama 的 OpenAI 兼容 API
     */
    private async callOllama(items: any[], systemPrompt: string, signal?: AbortSignal, maxRetries = 2, parseFn?: (content: string) => any[]): Promise<any[]> {
        const baseUrl = this.getBaseUrl();
        const model = this.getModelName();
        const url = `${baseUrl}/v1/chat/completions`;

        const requestBody = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(items) }
            ],
            temperature: 0.3,
            stream: false,
        };

        let attempt = 0;
        let lastError: any = null;

        while (attempt <= maxRetries) {
            const timeoutMs = this.getTimeout();
            const timeoutId = { id: null as any };

            try {
                if (signal?.aborted) throw new Error('翻译任务已取消');

                // Ollama 本地模型可能较慢，超时设高一些
                const effectiveTimeout = Math.max(timeoutMs, 120000);

                const responsePromise = requestUrl({
                    url,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    throw: false
                });

                // 手动实现超时
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timeoutId.id = setTimeout(() => reject(new Error(this.buildTimeoutMessage(effectiveTimeout))), effectiveTimeout);
                });

                const response = await Promise.race([responsePromise, timeoutPromise]);

                if (response.status !== 200) {
                    const errorMsg = response.json?.error?.message || `HTTP ${response.status}`;
                    throw new Error(`Ollama API 错误: ${errorMsg}`);
                }

                const data = response.json;
                const content = data?.choices?.[0]?.message?.content;

                if (!content) throw new Error('Ollama 返回内容为空');

                return (parseFn || this.parseResponseContent)(content);
            } catch (error: any) {
                const isManualAbort = signal?.aborted || error.message === '翻译任务已取消';
                if (isManualAbort) throw new Error('翻译任务已取消');

                // Judge 模式 (parseFn 存在) 超时不重试：超时错误 message 由 buildTimeoutMessage 生成
                if (parseFn && typeof error.message === 'string' && error.message.includes('请求超时')) {
                    throw error;
                }

                lastError = error;
                attempt++;

                if (attempt <= maxRetries) {
                    console.warn(`[Ollama API] 调用失败，正在尝试第 ${attempt} 次重试...`, lastError.message);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            } finally {
                if (timeoutId.id) clearTimeout(timeoutId.id);
            }
        }

        throw new Error(lastError?.message || '未知错误');
    }

    // ======================== 翻译实现 ========================

    protected async callRegexTranslationAPI(items: RegexItem[], signal?: AbortSignal): Promise<RegexItem[]> {
        const systemPrompt = this.getRegexSystemPrompt();
        const simplifiedItems = items.map(item => {
            const simplified: any = { i: item.id, s: item.source };
            return simplified;
        });
        const results = await this.callOllama(simplifiedItems, systemPrompt, signal);
        return this.mapResultsBack(items, results);
    }

    protected async callAstTranslationAPI(items: AstItem[], signal?: AbortSignal): Promise<AstItem[]> {
        const systemPrompt = this.getAstSystemPrompt();
        const simplifiedItems = items.map(item => {
            const simplified: any = { i: item.id, s: item.source, y: item.type, n: item.name };
            return simplified;
        });
        const results = await this.callOllama(simplifiedItems, systemPrompt, signal);
        return this.mapResultsBack(items, results);
    }

    protected async callThemeTranslationAPI(items: ThemeTranslationItem[], signal?: AbortSignal): Promise<ThemeTranslationItem[]> {
        const systemPrompt = this.getThemeSystemPrompt();
        const simplifiedItems = items.map(item => ({ i: (item as any).id, s: item.source, y: item.type }));
        const results = await this.callOllama(simplifiedItems, systemPrompt, signal);
        return this.mapResultsBack(items as any[], results) as unknown as ThemeTranslationItem[];
    }

    // ======================== 公共工具方法 ========================

    private static modelsCache: Record<string, { models: string[], timestamp: number }> = {};

    /**
     * 从 Ollama 获取已安装的模型列表
     */
    public static async fetchModels(baseUrl?: string): Promise<string[]> {
        const url = (baseUrl || OLLAMA_DEFAULT_URL).replace(/\/+$/, '');

        // 检查缓存
        const now = Date.now();
        const cached = this.modelsCache[url];
        if (cached && now - cached.timestamp < 5 * 60 * 1000) {
            return cached.models;
        }

        try {
            const response = await requestUrl({
                url: `${url}/api/tags`,
                method: 'GET',
                throw: false
            });

            if (response.status === 200 && response.json?.models) {
                const models = response.json.models.map((m: any) => m.name || m.model);
                this.modelsCache[url] = { models, timestamp: now };
                return models;
            }
            return [];
        } catch {
            return [];
        }
    }

    /**
     * Fix API — 修复单条翻译 (Ollama 实现)
     */
    protected override async callFixAPI(
        source: string,
        target: string,
        errorMessage: string,
        systemPrompt: string,
        signal?: AbortSignal
    ): Promise<string> {
        const baseUrl = this.getBaseUrl();
        const model = this.getModelName();
        const url = `${baseUrl}/v1/chat/completions`;

        const userContent = `Source: ${source}\nBroken Translation: ${target}\nError: ${errorMessage}\n\nPlease return ONLY the fixed translation string.`;

        const requestBody = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.2,
            stream: false,
        };

        const response = await requestUrl({
            url,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            throw: false
        });

        if (response.status !== 200) {
            const errorMsg = response.json?.error?.message || `HTTP ${response.status}`;
            throw new Error(`Ollama API 错误: ${errorMsg}`);
        }

        const content = response.json?.choices?.[0]?.message?.content;
        if (!content || content.trim() === '') throw new Error('AI 返回的修复结果为空');

        let cleaned = content.trim();
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1);
        if (cleaned.startsWith("'") && cleaned.endsWith("'")) cleaned = cleaned.slice(1, -1);

        return cleaned;
    }

    public supportsJudge(): boolean {
        return true;
    }

    /** Judge API — AI 判定 AST 条目是否需要翻译 (Ollama 实现) */
    protected async callJudgeAPI(items: JudgeItem[], signal?: AbortSignal): Promise<JudgeItem[]> {
        const systemPrompt = this.getJudgeSystemPrompt();
        const simplified = items.map(it => ({ i: it.id, s: it.source, y: it.type ?? null, n: it.name ?? null, k: it.propKey ?? null, a: it.argIndex ?? null, c: it.snippet ?? null }));
        const verdicts = await this.callOllama(simplified, systemPrompt, signal, 2, (c) => this.parseJudgeResponse(c)) as Array<{ i: number; verdict: AiVerdict; reason?: string; confidence?: number }>;
        return items.map(it => {
            const v = verdicts.find(x => x.i === it.id);
            return { ...it, verdict: v?.verdict ?? 'unjudged', reason: v?.reason, confidence: v?.confidence };
        });
    }
}
