/**
 * 云端译文下载共用逻辑
 * 供「探索页」与「跨库全局搜索」复用，避免两处维护同一套下载/更新流程
 */
import { getCloudFilePath, ManifestEntry } from '../types';
import { TranslationSource } from '~/types';
import { calculateChecksum } from '~/utils';

export interface DownloadCloudTranslationParams {
    i18n: any;
    owner: string;
    repo: string;
    entry: ManifestEntry;
    /**
     * 翻译函数（i18next 的 t）
     * 其函数签名重载极为复杂，这里用宽松类型接收，避免调用处出现类型不兼容
     */
    t: any;
}

export interface DownloadCloudTranslationResult {
    ok: boolean;
    /** 是否为「本地已有同名翻译且用户取消覆盖」 */
    cancelled?: boolean;
    title?: string;
    error?: string;
}

/**
 * 下载（或更新）一条云端译文到本地
 */
export async function downloadCloudTranslation(
    { i18n, owner, repo, entry, t }: DownloadCloudTranslationParams
): Promise<DownloadCloudTranslationResult> {
    const manager = i18n?.sourceManager;
    if (!manager) {
        // 前置校验：避免在 manager 缺失时仍发起网络请求并解析大文件
        const message = t('Cloud.Errors.DownloadFail');
        console.error(t('Cloud.Errors.DownloadFail'), new Error('sourceManager is unavailable'));
        i18n?.notice?.errorPrefix?.(t('Cloud.Errors.DownloadFail'), message);
        return { ok: false, title: entry.title, error: message };
    }

    try {
        // 1. 获取翻译文件内容 (使用 getFileContentWithFallback 支持大文件并避开 CDN 缓存或 403 问题)
        const fileRes = await i18n.api.github.getFileContentWithFallback(owner, repo, getCloudFilePath(entry.id, entry.type));
        if (!fileRes.state || !fileRes.data) {
            const errorDetail = fileRes.isRateLimit ? t('Cloud.Hints.RateLimitTitle') : (fileRes.data?.message || fileRes.data || '');
            throw new Error(`${t('Cloud.Errors.DownloadFail')}: ${errorDetail}`);
        }

        // getFileContentWithFallback 会自动解析 JSON 或返回文本
        const content = typeof fileRes.data === 'string' ? JSON.parse(fileRes.data) : fileRes.data;

        // 2. 检查是否已存在同一云端条目（考虑到本地新建的翻译可能还没绑定 cloud，只校验 id）
        const existingSource: TranslationSource | undefined = manager.getAllSources().find((s: TranslationSource) => s.id === entry.id);

        if (existingSource) {
            // 如果 owner 不一致，触发 fork 覆盖确认。如果本地源没有 cloud 信息，也视作被覆盖
            const isSameOwner = existingSource.cloud?.owner === owner && existingSource.cloud?.repo === repo;
            if (!isSameOwner) {
                const confirmMsg = t('Cloud.Dialogs.ConfirmOverwrite', '', {
                    owner: existingSource.cloud?.owner || t('Cloud.Status.Local'),
                    newOwner: owner,
                });
                if (!window.confirm(confirmMsg)) {
                    return { ok: false, cancelled: true, title: existingSource.title };
                }
            }

            // === 更新模式 ===
            manager.saveSourceFile(existingSource.id, content);
            const updatedSource: TranslationSource = {
                ...existingSource,
                origin: 'cloud',
                title: entry.title || existingSource.title,
                checksum: calculateChecksum(content),
                cloud: {
                    owner,
                    repo,
                    hash: entry.hash,
                },
                updatedAt: Date.now(),
            };
            manager.saveSource(updatedSource);
            i18n.notice.successPrefix(t('Cloud.Notices.UpdateSuccess'), t('Cloud.Tips.UpdatedItem', '', { title: updatedSource.title }));
            return { ok: true, title: updatedSource.title };
        }

        // === 新建模式 ===
        const sourceId = entry.id;
        manager.saveSourceFile(sourceId, content);

        const sourceInfo: TranslationSource = {
            id: sourceId,
            plugin: entry.plugin,
            title: entry.title || t('Common.Status.Unknown'),
            type: entry.type,
            origin: 'cloud',
            isActive: false,
            checksum: calculateChecksum(content),
            cloud: {
                owner,
                repo,
                hash: entry.hash,
            },
            updatedAt: Date.now(),
            createdAt: Date.now(),
        };

        manager.saveSource(sourceInfo);

        if (!manager.getActiveSourceId(entry.plugin)) {
            manager.setActive(sourceId, true);
            i18n.notice.successPrefix(t('Cloud.Notices.DownloadSuccess'), t('Cloud.Tips.AddedAndActive', '', { title: sourceInfo.title }));
        } else {
            i18n.notice.successPrefix(t('Cloud.Notices.DownloadSuccess'), t('Cloud.Tips.AddedSource', '', { title: sourceInfo.title }));
        }

        return { ok: true, title: sourceInfo.title };
    } catch (error) {
        const message = `${error}`;
        console.error(t('Cloud.Errors.DownloadFail'), error);
        i18n?.notice?.errorPrefix?.(t('Cloud.Errors.DownloadFail'), message);
        return { ok: false, title: entry.title, error: message };
    }
}
