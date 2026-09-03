/**
 * 翻译源管理器 (扁平化结构 v2)
 * 负责管理多翻译源的元数据、激活状态和文件路径
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { TranslationSourceMeta, TranslationSource, EMPTY_META, PluginTranslationV1, IgnoredKeysStore, EMPTY_IGNORED_KEYS } from '../types';
import { calculateChecksum } from '../utils/translator/translation';
import { nanoid } from 'nanoid';
import { useGlobalStoreInstance } from '~/utils';
import { t } from '../locales'; // Correct import path
import { loadTranslationFile, saveTranslationFile, TRANSLATION_FILE_EXTENSION } from './io-manager';

export class SourceManager {
    private basePath: string;           // i18n插件目录
    public sourcesDir: string;         // translation-sources目录
    private metaPath: string;           // meta.json路径
    private checkpointPath: string;     // backup-checkpoint.json路径
    private ignoredKeysPath: string;    // ignored-keys.json路径 (人工标记，生命周期独立于翻译源)
    private meta: TranslationSourceMeta;
    private ignoredKeys: IgnoredKeysStore;

    constructor(i18nPluginDir: string) {
        this.basePath = i18nPluginDir;
        this.sourcesDir = path.join(i18nPluginDir, 'translations');
        this.metaPath = path.join(i18nPluginDir, 'metadata.json');
        this.checkpointPath = path.join(i18nPluginDir, 'backup-checkpoint.json');
        this.ignoredKeysPath = path.join(i18nPluginDir, 'ignored-keys.json');
        this.meta = this.loadMeta();
        this.ignoredKeys = this.loadIgnoredKeysStore();
    }

    // ========== 元数据管理 ========== 

    /**
     * 加载元数据 (支持自动迁移旧版本)
     */
    private loadMeta(): TranslationSourceMeta {
        try {
            if (fs.existsSync(this.metaPath)) {
                const raw = fs.readJsonSync(this.metaPath);
                // 自动迁移旧版本数据
                if (raw.sources) {
                    let needsSave = false;
                    for (const source of Object.values(raw.sources) as any[]) {
                        // 迁移 type → origin（旧版 type 值为 'cloud'|'local'）
                        if (!source.origin && (source.type === 'cloud' || source.type === 'local')) {
                            source.origin = source.type;
                            source.type = 'plugin'; // 旧数据全部是插件翻译
                            needsSave = true;
                        }
                        // 迁移 pluginId → plugin
                        if ('pluginId' in source && !('plugin' in source)) {
                            source.plugin = source.pluginId;
                            delete source.pluginId;
                            needsSave = true;
                        }
                        // 清理已废弃的字段
                        for (const field of ['language', 'version', 'supportedVersions']) {
                            if (field in source) {
                                delete source[field];
                                needsSave = true;
                            }
                        }
                    }
                    if (needsSave) {
                        fs.ensureDirSync(this.sourcesDir);
                        fs.writeJsonSync(this.metaPath, raw, { spaces: 2 });
                    }
                }
                return raw;
            }
        } catch (error) {
            console.error('[SourceManager] Failed to load meta:', error);
        }
        return JSON.parse(JSON.stringify(EMPTY_META));
    }

    /**
     * 保存元数据
     */
    private saveMeta(): void {
        try {
            fs.ensureDirSync(this.sourcesDir);
            fs.writeJsonSync(this.metaPath, this.meta, { spaces: 2 });
            useGlobalStoreInstance.getState().triggerSourceUpdate();
        } catch (error) {
            console.error('[SourceManager] Failed to save meta:', error);
            throw error;
        }
    }

    // ========== 基础查询 ==========

    /**
     * 根据ID获取翻译源
     */
    getSource(sourceId: string): TranslationSource | null {
        return this.meta.sources[sourceId] || null;
    }

    /**
     * 删除翻译源
     */
    deleteSource(sourceId: string): void {
        if (this.meta.sources[sourceId]) {
            delete this.meta.sources[sourceId];
            this.saveMeta();
        }
    }

    /**
     * 清理所有翻译源 (删除文件和元数据)
     */
    public clearAll(): void {
        this.meta.sources = {};
        if (fs.existsSync(this.sourcesDir)) {
            fs.emptyDirSync(this.sourcesDir);
        }
        this.saveMeta();
    }

    /**
     * 获取所有翻译源
     */
    getAllSources(): TranslationSource[] {
        return Object.values(this.meta.sources);
    }

    /**
     * 获取插件的所有翻译源
     */
    getSourcesForPlugin(pluginId: string): TranslationSource[] {
        return Object.values(this.meta.sources).filter(s => s.plugin === pluginId);
    }

    /**
     * 获取当前激活的翻译源ID
     */
    getActiveSourceId(pluginId: string): string | null {
        const sources = this.getSourcesForPlugin(pluginId);
        const active = sources.find(s => s.isActive);

        // 如果没有明确激活的，默认返回第一个
        if (!active && sources.length > 0) {
            return sources[0].id;
        }

        return active?.id || null;
    }

    /**
     * 获取当前激活的翻译源信息
     */
    getActiveSource(pluginId: string): TranslationSource | null {
        const activeId = this.getActiveSourceId(pluginId);
        if (!activeId) return null;
        return this.meta.sources[activeId] || null;
    }

    // ========== 增删改 ==========

    /**
     * 添加/更新翻译源
     */
    saveSource(source: TranslationSource): void {
        const now = Date.now();

        if (this.meta.sources[source.id]) {
            // 更新现有
            this.meta.sources[source.id] = {
                ...this.meta.sources[source.id],
                ...source,
                updatedAt: now
            };
        } else {
            // 添加新的
            source.createdAt = source.createdAt || now;
            source.updatedAt = now;
            this.meta.sources[source.id] = source;
        }

        this.saveMeta();
    }

    /**
     * 批量添加/更新翻译源 (减少磁盘写入)
     */
    batchSaveSources(sources: TranslationSource[]): void {
        const now = Date.now();
        for (const source of sources) {
            if (this.meta.sources[source.id]) {
                this.meta.sources[source.id] = {
                    ...this.meta.sources[source.id],
                    ...source,
                    updatedAt: now
                };
            } else {
                source.createdAt = source.createdAt || now;
                source.updatedAt = now;
                this.meta.sources[source.id] = source;
            }
        }
        this.saveMeta();
    }

    /**
     * 删除翻译源
     */
    removeSource(sourceId: string): void {
        const source = this.meta.sources[sourceId];
        if (!source) return;

        const wasActive = source.isActive;
        const pluginId = source.plugin;

        // 删除元数据
        delete this.meta.sources[sourceId];

        // 如果删除的是激活源，尝试激活同插件的第一个
        if (wasActive) {
            const remaining = this.getSourcesForPlugin(pluginId);
            if (remaining.length > 0) {
                remaining[0].isActive = true;
                this.saveMeta();
            }
        }

        // 删除对应文件
        const filePath = this.getSourceFilePath(sourceId);
        if (fs.existsSync(filePath)) {
            fs.removeSync(filePath);
        }

        this.saveMeta();
    }

    /**
     * 设置激活状态（自动取消同插件的其他激活）
     */
    setActive(sourceId: string, active: boolean): void {
        const source = this.meta.sources[sourceId];
        if (!source) return;

        if (active) {
            // 取消同插件的其他激活
            Object.values(this.meta.sources)
                .filter(s => s.plugin === source.plugin)
                .forEach(s => s.isActive = false);
        }

        source.isActive = active;
        this.saveMeta();
    }


    // ========== 路径管理 ==========

    /**
     * 获取翻译源文件路径
     */
    getSourceFilePath(sourceId: string): string {
        return path.join(this.sourcesDir, `${sourceId}.${TRANSLATION_FILE_EXTENSION}`);
    }

    /**
     * 获取激活翻译源的文件路径
     */
    getActiveSourcePath(pluginId: string): string | null {
        const activeId = this.getActiveSourceId(pluginId);
        if (!activeId) return null;
        return this.getSourceFilePath(activeId);
    }

    /**
     * 获取翻译文件的有效路径（优先激活源）
     */
    getTranslationPath(pluginId: string, pluginDir: string): string {
        const activePath = this.getActiveSourcePath(pluginId);
        if (activePath && fs.existsSync(activePath)) {
            return activePath;
        }
        return '';
    }

    // ========== 批量操作 ==========

    /**
     * 获取所有有翻译源的插件ID
     */
    getPluginIds(): string[] {
        const ids = new Set<string>();
        Object.values(this.meta.sources).forEach(s => ids.add(s.plugin));
        return Array.from(ids);
    }

    /**
     * 检查是否有任何翻译源
     */
    hasAnySources(pluginId: string): boolean {
        return this.getSourcesForPlugin(pluginId).length > 0;
    }

    // ========== 辅助方法 ==========

    /**
     * 生成随机ID (使用 NanoID 32字符)
     */
    private generateRandomId(): string {
        return nanoid(32);
    }

    /**
     * 生成翻译源ID (使用 NanoID 32字符)
     */
    generateSourceId(title: string): string {
        return nanoid(32);
    }

    /**
     * 保存翻译源文件
     */
    saveSourceFile(sourceId: string, content: any): void {
        const filePath = path.join(this.sourcesDir, `${sourceId}.${TRANSLATION_FILE_EXTENSION}`);
        saveTranslationFile(filePath, content);
    }

    /**
     * 读取翻译源文件
     */
    readSourceFile(sourceId: string): any {
        const filePath = this.getSourceFilePath(sourceId);
        return loadTranslationFile(filePath);
    }

    /**
     * 获取翻译源文件中的 metadata
     */
    getSourceMetadata(sourceId: string): any | null {
        try {
            const content = this.readSourceFile(sourceId);
            return content?.metadata || null;
        } catch {
            return null;
        }
    }

    // ========== 人工标记持久化 (ignored-keys.json) ==========

    /**
     * 加载人工标记存储。标记独立于翻译源持久化：
     * 翻译源可以删了重新提取，但「用户判定这条不需要翻译」是花了人工成本的知识，必须活得更久。
     */
    private loadIgnoredKeysStore(): IgnoredKeysStore {
        try {
            if (fs.existsSync(this.ignoredKeysPath)) {
                const raw = fs.readJsonSync(this.ignoredKeysPath);
                if (raw?.plugins && typeof raw.plugins === 'object') {
                    return { version: 1, plugins: raw.plugins };
                }
            }
        } catch (error) {
            console.error('[SourceManager] Failed to load ignored keys:', error);
        }
        return JSON.parse(JSON.stringify(EMPTY_IGNORED_KEYS));
    }

    private saveIgnoredKeysStore(): void {
        try {
            fs.ensureDirSync(this.basePath);
            fs.writeJsonSync(this.ignoredKeysPath, this.ignoredKeys, { spaces: 2 });
        } catch (error) {
            console.error('[SourceManager] Failed to save ignored keys:', error);
        }
    }

    private setIgnoredKeys(pluginId: string, file: string, keys: { ast: string[]; regex: string[] }): void {
        const plugins = { ...this.ignoredKeys.plugins };
        plugins[pluginId] = { ...(plugins[pluginId] ?? {}), [file]: keys };
        this.ignoredKeys = { version: 1, plugins };
        this.saveIgnoredKeysStore();
    }

    /**
     * 读取某插件全部源文件的人工标记集合（权威来源）。
     * 只认 sidecar——功能发布起标记就只存在这里，不存在需要从翻译源回填的存量数据。
     */
    public getPluginIgnoredKeys(pluginId: string): Record<string, { ast: string[]; regex: string[] }> {
        const stored = this.ignoredKeys.plugins[pluginId];
        const normalized: Record<string, { ast: string[]; regex: string[] }> = {};
        for (const [file, keys] of Object.entries(stored ?? {})) {
            normalized[file] = { ast: keys?.ast ?? [], regex: keys?.regex ?? [] };
        }
        return normalized;
    }

    /**
     * 增量更新标记集合（编辑器内标记/取消标记时调用）。
     * 同步落盘：标记是低频人工操作，无需防抖；写失败只记日志，不阻断编辑操作。
     */
    public upsertIgnoredKeys(pluginId: string, file: string, kind: 'ast' | 'regex', added: string[], removed: string[]): void {
        if (!pluginId || !file || (added.length === 0 && removed.length === 0)) return;
        const current = this.getPluginIgnoredKeys(pluginId)[file] ?? { ast: [], regex: [] };
        const keys = new Set(current[kind]);
        for (const key of added) keys.add(key);
        for (const key of removed) keys.delete(key);
        this.setIgnoredKeys(pluginId, file, { ...current, [kind]: Array.from(keys) });
    }

    /** 清空某插件（或全部）的人工标记。删除翻译源不会自动调用：删源 ≠ 判定作废。 */
    public clearIgnoredKeys(pluginId?: string): void {
        if (!pluginId) {
            this.ignoredKeys = JSON.parse(JSON.stringify(EMPTY_IGNORED_KEYS));
        } else {
            const plugins = { ...this.ignoredKeys.plugins };
            delete plugins[pluginId];
            this.ignoredKeys = { version: 1, plugins };
        }
        this.saveIgnoredKeysStore();
    }

    /**
     * 把 sidecar 里的权威标记写进新提取的翻译内容（源内镜像）。
     * 注意：会原地修改 content，必须在计算 checksum 之前调用。
     */
    private applyIgnoredKeysInto(pluginId: string, content: PluginTranslationV1): void {
        // 仅插件类翻译 (dict 为对象) 有该机制；主题的 dict 是数组，跳过
        if (!content?.dict || typeof content.dict !== 'object' || Array.isArray(content.dict)) return;

        for (const [file, keys] of Object.entries(this.getPluginIgnoredKeys(pluginId))) {
            if (!content.dict[file]) continue;
            if (keys.ast.length === 0 && keys.regex.length === 0) continue;
            content.dict[file].ignoredKeys = { ast: keys.ast, regex: keys.regex };
        }
    }

    /**
     * 执行提取流程 (始终新建)
     */
    public async extractAndSaveSource(pluginId: string, content: any, options: TranslationExtractionOptions): Promise<string> {
        const sourceId = this.generateRandomId();

        // 提取始终全新生成，但人工「不需要翻译」标记须跨提取持久：先写入源内镜像再算 checksum，
        // 保证 checksum 与最终落盘内容一致
        this.applyIgnoredKeysInto(pluginId, content);

        const translationSource: TranslationSource = {
            id: sourceId,
            plugin: pluginId,
            title: options.title || t('func.extract_local'),
            type: options.type || 'plugin',
            origin: 'local',
            isActive: true,
            checksum: calculateChecksum(content),
            updatedAt: Date.now(),
            createdAt: Date.now()
        };

        // 取消同插件的其他激活
        Object.values(this.meta.sources).filter(s => s.plugin === pluginId).forEach(s => s.isActive = false);

        // 保存文件 (使用新格式)
        this.saveSourceFile(sourceId, content);

        // 保存元数据
        this.saveSource(translationSource);

        return sourceId;
    }

    // ========== 检查点 (Checkpoint) 管理 ==========

    /**
     * 保存备份检查点
     */
    saveCheckpoint(data: any): void {
        try {
            fs.writeJsonSync(this.checkpointPath, {
                ...data,
                timestamp: Date.now()
            }, { spaces: 2 });
        } catch (error) {
            console.error('[SourceManager] Failed to save checkpoint:', error);
        }
    }

    /**
     * 加载备份检查点
     */
    loadCheckpoint(): any | null {
        try {
            if (fs.existsSync(this.checkpointPath)) {
                return fs.readJsonSync(this.checkpointPath);
            }
        } catch (error) {
            console.error('[SourceManager] Failed to load checkpoint:', error);
        }
        return null;
    }

    /**
     * 清除备份检查点
     */
    clearCheckpoint(): void {
        try {
            if (fs.existsSync(this.checkpointPath)) {
                fs.removeSync(this.checkpointPath);
            }
        } catch (error) {
            console.error('[SourceManager] Failed to clear checkpoint:', error);
        }
    }
}




export interface TranslationExtractionOptions {
    title?: string;
    description?: string;
    type?: 'plugin' | 'theme';
}

