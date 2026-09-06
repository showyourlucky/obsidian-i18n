/**
 * 跨库全局搜索结果面板
 * 一次性检索「某个插件在哪些云端翻译库里存在译文」，并支持直接下载
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Layers, Palette, Search, ArrowRight, Star, Github, CircleCheckBig, Globe, Zap, ShieldCheck, RefreshCw } from 'lucide-react';

import { Button, Badge, ScrollArea } from '@/src/shadcn';
import { cn } from '@/src/shadcn/lib/utils';
import { useGlobalStoreInstance } from '~/utils';
import { useCloudStore } from '../cloud-store';
import { GlobalSearchHit } from '../types';
import { downloadCloudTranslation } from '../utils/download';

interface GlobalPluginSearchProps {
    /** 点击「在库中查看」时跳转 */
    onViewRepo: (address: string) => void;
    /** 当前语言过滤条件（深度搜索时需保持一致） */
    filterLanguage?: string;
}

export const GlobalPluginSearch: React.FC<GlobalPluginSearchProps> = ({ onViewRepo, filterLanguage = 'all' }) => {
    const { t: t_i18n } = useTranslation();
    const i18n = useGlobalStoreInstance.getState().i18n;
    const sourceUpdateTick = useGlobalStoreInstance((state) => state.sourceUpdateTick);

    const query = useCloudStore.use.globalSearchQuery();
    const hits = useCloudStore.use.globalSearchHits();
    const searching = useCloudStore.use.globalSearching();
    const ran = useCloudStore.use.globalSearchRan();
    const unindexed = useCloudStore.use.globalSearchUnindexed();
    const rateLimited = useCloudStore.use.globalSearchRateLimited();
    const progress = useCloudStore.use.globalSearchProgress();
    const communityRegistry = useCloudStore.use.communityRegistry();
    const communityStats = useCloudStore.use.communityStats();
    const searchGlobalPlugins = useCloudStore.use.searchGlobalPlugins();

    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    // 本地已安装的云端译文 id → source 映射（用于标记「已下载」，且需校验来源仓库）
    // sourceUpdateTick 会在 sourceManager 写入元数据后自增，保证下载后即时刷新
    const localSourceMap = useMemo(() => {
        const sources = i18n.sourceManager?.getAllSources?.() || [];
        const map = new Map<string, any>();
        sources.forEach((s: any) => map.set(s.id, s));
        return map;
    }, [i18n, sourceUpdateTick]);

    const handleDownload = useCallback(async (hit: GlobalSearchHit) => {
        if (downloadingId) return;
        const [owner, repo] = hit.repoAddress.split('/');
        if (!owner || !repo) return;

        setDownloadingId(hit.entry.id);
        try {
            await downloadCloudTranslation({ i18n, owner, repo, entry: hit.entry, t: t_i18n });
        } finally {
            setDownloadingId(null);
        }
    }, [i18n, downloadingId, t_i18n]);

    const handleDeepSearch = useCallback(() => {
        if (!query.trim()) return;
        searchGlobalPlugins(i18n, query, { deep: true, language: filterLanguage });
    }, [i18n, query, filterLanguage, searchGlobalPlugins]);

    // ========== 加载中 ==========
    if (searching) {
        const { current, total } = progress;
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground animate-in fade-in duration-300 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary/60" />
                <p className="text-xs font-medium tracking-tight">
                    {total > 0
                        ? t_i18n('Cloud.Hints.GlobalSearchProgress', { current, total })
                        : t_i18n('Cloud.Labels.FetchingResources')}
                </p>
            </div>
        );
    }

    // ========== GitHub 限流 → 明确告知，避免残缺结果误导 ==========
    if (rateLimited) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <div className="max-w-md space-y-4 animate-in fade-in duration-300">
                    <div className="p-4 rounded-full bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/20 w-fit mx-auto">
                        <Globe className="w-8 h-8 opacity-80" />
                    </div>
                    <h3 className="text-base font-bold tracking-tight">
                        {t_i18n('Cloud.Hints.RateLimitTitle')}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {t_i18n('Cloud.Hints.RateLimitDesc')}
                    </p>
                    <Button onClick={handleDeepSearch} className="gap-2 px-5 shadow-sm">
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t_i18n('Cloud.Actions.DeepSearch')}
                    </Button>
                </div>
            </div>
        );
    }

    // ========== 索引未命中 → 引导深度搜索 ==========
    if (unindexed) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <div className="max-w-md space-y-4 animate-in fade-in duration-300">
                    <div className="p-4 rounded-full bg-primary/5 text-primary ring-1 ring-primary/10 w-fit mx-auto">
                        <Search className="w-8 h-8 opacity-60" />
                    </div>
                    <h3 className="text-base font-bold tracking-tight">
                        {t_i18n('Cloud.Hints.GlobalSearchUnindexed', { query: query.trim() })}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {t_i18n('Cloud.Hints.GlobalSearchUnindexedDesc', { count: communityRegistry.length })}
                    </p>
                    <Button onClick={handleDeepSearch} className="gap-2 px-5 shadow-sm">
                        <Zap className="w-3.5 h-3.5" />
                        {t_i18n('Cloud.Actions.DeepSearch')}
                    </Button>
                </div>
            </div>
        );
    }

    // ========== 空态 ==========
    if (hits.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <div className="max-w-md space-y-3 animate-in fade-in duration-300">
                    <div className="p-4 rounded-full bg-muted/30 w-fit mx-auto">
                        {ran
                            ? <Search className="w-8 h-8 opacity-20" />
                            : <Globe className="w-8 h-8 opacity-20" />}
                    </div>
                    <p className="text-sm font-medium text-foreground/70">
                        {ran ? t_i18n('Cloud.Hints.NoMatchingPlugins') : t_i18n('Cloud.Hints.GlobalSearchIdle')}
                    </p>
                    {!ran && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {t_i18n('Cloud.Hints.GlobalSearchTip')}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // ========== 结果列表 ==========
    return (
        <div className="flex flex-col h-full min-h-0">
            {/* 结果统计条 */}
            <div className="flex items-center gap-2 mb-3 shrink-0 text-[11px] text-muted-foreground">
                <Badge variant="secondary" className="px-2 py-0.5 text-[10px] font-black bg-primary/10 text-primary border-primary/20 rounded-full">
                    {hits.length}
                </Badge>
                <span>{t_i18n('Cloud.Labels.GlobalSearchResultCount')}</span>
                <span className="opacity-40">·</span>
                <span className="font-mono truncate max-w-[220px]">{query.trim()}</span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={handleDeepSearch}
                    title={t_i18n('Cloud.Actions.DeepSearch')}
                >
                    <RefreshCw className="w-3 h-3" />
                </Button>
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="flex flex-col gap-2 pb-6 pr-3">
                    {hits.map((hit) => {
                        const [owner, repo] = hit.repoAddress.split('/');
                        const stats = communityStats?.repos?.[hit.repoAddress];
                        const registryItem = communityRegistry.find((r) => r.repoAddress === hit.repoAddress);
                        // 「已安装」需同时校验 id 与来源仓库一致：同一译文被镜像到多个仓库时，
                        // 仅按 id 判定会让所有镜像条目都误显示「已安装/Update」
                        const localSource = localSourceMap.get(hit.entry.id);
                        const installed = !!localSource && localSource.cloud?.owner === owner && localSource.cloud?.repo === repo;
                        const isDownloading = downloadingId === hit.entry.id;

                        return (
                            <div
                                key={`${hit.repoAddress}-${hit.entry.id}`}
                                className="group flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/60 hover:bg-muted/30 hover:border-primary/30 transition-all"
                            >
                                {/* 类型图标 */}
                                <div className={cn(
                                    "flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border border-border/10",
                                    hit.entry.type === 'theme' ? "bg-purple-500/10 text-purple-500" : "bg-blue-500/10 text-blue-500"
                                )}>
                                    {hit.entry.type === 'theme'
                                        ? <Palette className="w-4 h-4" />
                                        : <Layers className="w-4 h-4" />}
                                </div>

                                {/* 主信息 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[13px] font-bold text-foreground truncate leading-tight" title={hit.entry.title}>
                                            {hit.entry.title || hit.entry.plugin}
                                        </span>
                                        {installed && (
                                            <Badge variant="outline" className="h-[15px] px-1 text-[8px] border-emerald-500/30 text-emerald-600 bg-emerald-500/5 font-black shrink-0">
                                                <CircleCheckBig className="w-2 h-2 mr-0.5" />
                                                {t_i18n('Cloud.Labels.Installed')}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                        <span className="text-[10px] font-mono text-muted-foreground/70 truncate" title={hit.entry.plugin}>
                                            {hit.entry.plugin}
                                        </span>
                                        <span className="opacity-30">·</span>
                                        <Badge variant="secondary" className="h-[15px] px-1.5 text-[8px] font-bold bg-muted/40 border-none shrink-0">
                                            {hit.entry.language || t_i18n('Common.Status.Unknown')}
                                        </Badge>
                                        {hit.entry.supported_versions && (
                                            <span
                                                className="inline-flex items-center h-[15px] px-1.5 rounded text-[9px] font-bold font-mono text-blue-600 bg-blue-500/10 border border-blue-500/20 shrink-0"
                                                title={t_i18n('Cloud.Labels.SupportedVersions')}
                                            >
                                                {t_i18n('Cloud.Labels.AdaptedVersion')} {hit.entry.supported_versions}
                                            </span>
                                        )}
                                        {hit.entry.version && (
                                            <span
                                                className="inline-flex items-center h-[15px] px-1.5 rounded text-[9px] font-bold font-mono text-muted-foreground bg-muted/40 border-none shrink-0"
                                                title={t_i18n('Cloud.Labels.Version')}
                                            >
                                                {t_i18n('Cloud.Labels.TranslationVersion')} v{hit.entry.version}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 来源仓库 */}
                                <div className="flex items-center gap-2 w-[200px] shrink-0 pl-3 border-l border-border/30">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1 min-w-0">
                                            {registryItem?.isOfficial && (
                                                <ShieldCheck className="w-3 h-3 text-blue-500 fill-blue-500/10 shrink-0" />
                                            )}
                                            {registryItem?.isFeatured && (
                                                <Zap className="w-3 h-3 text-orange-500 fill-orange-500/10 shrink-0" />
                                            )}
                                            <span className="text-[10px] font-semibold text-foreground/80 truncate" title={hit.repoAddress}>
                                                {repo}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
                                            <Star className="w-2 h-2 fill-yellow-500/70 text-yellow-500" />
                                            <span className="font-mono">{stats?.stars || 0}</span>
                                            <span className="opacity-30">·</span>
                                            <span className="truncate">{stats?.authorName || owner}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* 操作 */}
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                        onClick={() => onViewRepo(hit.repoAddress)}
                                        title={t_i18n('Cloud.Labels.ExploreThisRepo')}
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                    <a
                                        href={`https://github.com/${hit.repoAddress}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-all"
                                        title="GitHub"
                                    >
                                        <Github className="w-3.5 h-3.5" />
                                    </a>
                                    <Button
                                        size="sm"
                                        className="h-7 px-3 text-[11px] font-bold shadow-sm"
                                        disabled={isDownloading}
                                        onClick={() => handleDownload(hit)}
                                    >
                                        {isDownloading
                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : <>
                                                <Download className="w-3.5 h-3.5 mr-1" />
                                                {installed ? t_i18n('Cloud.Actions.Update') : t_i18n('Cloud.Actions.Download')}
                                            </>}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
};
