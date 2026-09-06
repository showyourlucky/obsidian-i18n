/**
 * 云端翻译管理状态管理
 */
import { create } from 'zustand';
import { CloudTabType, SearchParams, UploadFormData, LocalTranslationFile, ManifestEntry, RegistryItem, CommunityStatsData, OutdatedSource, BackupProgress, GithubUserInfo, GithubRepoInfo, ContributorEntry, GlobalSearchHit, RepoManifestCacheEntry } from './types';
import { createSelectors } from '@/src/utils';

/** 全局搜索时，单个仓库 metadata.json 的缓存有效期 (10 分钟) */
const MANIFEST_CACHE_TTL = 10 * 60 * 1000;

/** 全局搜索时，并发拉取 metadata.json 的批次大小 */
const MANIFEST_FETCH_BATCH = 5;

// Store 状态接口
interface CloudState {
    // ===== 通用状态 =====
    currentTab: CloudTabType;
    isLoading: boolean;
    error: string | null;

    // ===== 社区目录状态 =====
    communityRegistry: RegistryItem[];
    communityStats: CommunityStatsData | null;
    communityLoaded: boolean;
    communityLoading: boolean;

    // ===== 跨库全局搜索状态 =====
    globalSearchQuery: string;
    globalSearchHits: GlobalSearchHit[];
    globalSearching: boolean;
    /** 已针对当前 query 执行过检索 */
    globalSearchRan: boolean;
    /** 插件 ID 索引未命中，需要用户确认深度搜索（遍历全部仓库） */
    globalSearchUnindexed: boolean;
    /** 全局搜索因 GitHub 限流而中止 */
    globalSearchRateLimited: boolean;
    globalSearchProgress: { current: number; total: number };
    /** 检索序号：每次发起检索自增，用于让仍在途的旧检索结果作废 */
    globalSearchSeq: number;
    /** 各仓库 metadata.json 的会话缓存，避免重复请求 */
    manifestCache: Record<string, RepoManifestCacheEntry>;

    // ===== 贡献者鸣谢状态 =====
    contributors: ContributorEntry[];
    contributorsLoaded: boolean;

    // ===== 个人仓库状态 =====
    repoDataLoaded: boolean;
    repoInitialized: boolean;
    repoChecking: boolean;
    repoManifest: ManifestEntry[];
    githubUser: GithubUserInfo | null;
    isForking: boolean;
    canCreateRepo: boolean;
    repoNameInput: string;
    repoDescriptionInput: string;
    myRepoInfo: GithubRepoInfo | null;
    myRepoReadme: string | null;

    // ===== 下载页状态 =====
    searchParams: SearchParams;
    totalPages: number;
    targetRepoAddress: string;
    targetRepoStars: number | null;
    targetManifest: ManifestEntry[];
    savedRepos: string[];
    targetRepoReadme: string | null;

    // ===== 上传页状态 =====
    uploadForm: UploadFormData;
    uploadType: 'plugin' | 'theme';
    localFiles: LocalTranslationFile[];
    selectedPluginId: string;
    selectedSourceId: string;

    // ===== 更新检查状态 =====
    outdatedSources: OutdatedSource[];
    isCheckingUpdates: boolean;

    // ===== 历史回滚 =====
    historyDialogEntryId: string | null;

    // ===== 备份/恢复 =====
    backupDialogOpen: boolean;
    backupDialogMode: 'backup' | 'restore' | null;
    backupProgress: BackupProgress | null;

    // ===== 差异对比 =====
    diffDialogSourceId: string | null;
    refreshVersion: number;

    // ===== 权限状态 =====
    isAdmin: boolean;
    isPushing: boolean;
}


// Store Actions 接口
interface CloudActions {

    // Tab 切换
    setCurrentTab: (tab: CloudTabType) => void;

    // 社区目录
    setCommunityRegistry: (items: RegistryItem[]) => void;
    setCommunityStats: (stats: CommunityStatsData | null) => void;
    setCommunityLoaded: (loaded: boolean) => void;
    setCommunityLoading: (loading: boolean) => void;

    // 跨库全局搜索
    setGlobalSearchQuery: (query: string) => void;
    clearGlobalSearch: () => void;
    searchGlobalPlugins: (i18n: any, query: string, options?: { deep?: boolean; language?: string }) => Promise<void>;

    // 个人仓库
    setRepoDataLoaded: (loaded: boolean) => void;
    setRepoInitialized: (initialized: boolean) => void;
    setRepoChecking: (checking: boolean) => void;
    setRepoManifest: (manifest: ManifestEntry[]) => void;
    setGithubUser: (user: GithubUserInfo | null) => void;
    setIsForking: (isForking: boolean) => void;
    setCanCreateRepo: (can: boolean) => void;
    setRepoNameInput: (name: string) => void;
    setRepoDescriptionInput: (desc: string) => void;
    setMyRepoInfo: (info: GithubRepoInfo | null) => void;
    setMyRepoReadme: (content: string | null) => void;

    // 搜索
    setSearchQuery: (query: string) => void;
    setSearchLanguage: (language: string) => void;
    setSearchPage: (page: number) => void;

    // 翻译列表
    setTotalPages: (pages: number) => void;

    // 下载页
    setTargetRepoAddress: (address: string) => void;
    setTargetRepoStars: (stars: number | null) => void;
    setTargetManifest: (manifest: ManifestEntry[]) => void;
    setSavedRepos: (repos: string[]) => void;
    setTargetRepoReadme: (content: string | null) => void;
    addSavedRepo: (address: string) => void;
    removeSavedRepo: (address: string) => void;

    // ===== 上传页动作 =====
    setUploadType: (type: 'plugin' | 'theme') => void;
    setSelectedPluginId: (pluginId: string) => void;
    setSelectedSourceId: (sourceId: string) => void;
    setUploadForm: (form: Partial<UploadFormData>) => void;
    setLocalFiles: (files: LocalTranslationFile[]) => void;
    resetUploadForm: () => void;

    // 更新检查
    setOutdatedSources: (sources: OutdatedSource[]) => void;
    setIsCheckingUpdates: (is: boolean) => void;

    // 加载状态
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;

    // 历史回滚
    setHistoryDialogEntryId: (id: string | null) => void;

    // 备份/恢复
    setBackupDialogOpen: (open: boolean) => void;
    setBackupDialogMode: (mode: 'backup' | 'restore' | null) => void;
    setBackupProgress: (progress: BackupProgress | null) => void;

    // 差异对比
    setDiffDialogSourceId: (id: string | null) => void;

    // 权限管理
    setIsAdmin: (isAdmin: boolean) => void;
    fetchGithubUser: (i18n: any) => Promise<void>;
    fetchCommunityRegistry: (i18n: any) => Promise<void>;
    pushRegistryToCloud: (i18n: any) => Promise<boolean>;

    // 贡献者鸣谢
    setContributors: (contributors: ContributorEntry[]) => void;
    setContributorsLoaded: (loaded: boolean) => void;
    fetchContributors: (i18n: any) => Promise<void>;
    pushContributorsToCloud: (i18n: any) => Promise<boolean>;
    addContributor: (entry: ContributorEntry) => void;
    removeContributor: (name: string, category: string) => void;
    updateContributor: (name: string, category: string, data: Partial<ContributorEntry>) => void;

    // 注册表管理 (管理员功能)
    updateRegistryItem: (repoAddress: string, data: Partial<RegistryItem>) => void;

    // 重置
    reset: () => void;
}

// 初始状态
const initialState: CloudState = {
    currentTab: 'community',
    isLoading: false,
    error: null,

    communityRegistry: [],
    communityStats: null,
    communityLoaded: false,
    communityLoading: false,

    globalSearchQuery: '',
    globalSearchHits: [],
    globalSearching: false,
    globalSearchRan: false,
    globalSearchUnindexed: false,
    globalSearchRateLimited: false,
    globalSearchProgress: { current: 0, total: 0 },
    globalSearchSeq: 0,
    manifestCache: {},

    contributors: [],
    contributorsLoaded: false,

    repoDataLoaded: false,
    repoInitialized: false,
    repoChecking: false,
    repoManifest: [],
    githubUser: null,
    isForking: false,
    canCreateRepo: false,
    repoNameInput: 'obsidian-i18n-resources',
    repoDescriptionInput: '',
    myRepoInfo: null,
    myRepoReadme: null,

    searchParams: {
        query: '',
        language: 'zh-cn',
        page: 1,
        page_size: 20,
    },
    totalPages: 1,
    targetRepoAddress: '',
    targetRepoStars: null,
    targetManifest: [],
    savedRepos: [],
    targetRepoReadme: null,

    uploadType: 'plugin',
    uploadForm: {
        plugin_id: '',
        title: '',
        description: '',
        version: '',
    },
    localFiles: [],
    selectedPluginId: '',
    selectedSourceId: '',

    outdatedSources: [],
    isCheckingUpdates: false,

    historyDialogEntryId: null,

    backupDialogOpen: false,
    backupDialogMode: null,
    backupProgress: null,

    diffDialogSourceId: null,
    refreshVersion: 0,
    isAdmin: false,
    isPushing: false,
};


// 创建 Store
const useCloudStoreBase = create<CloudState & CloudActions>()((set, get) => ({
    ...initialState,

    // Tab 切换
    setCurrentTab: (tab) => set({ currentTab: tab }),

    // 社区目录
    setCommunityRegistry: (communityRegistry) => set({ communityRegistry }),
    setCommunityStats: (communityStats) => set({ communityStats }),
    setCommunityLoaded: (communityLoaded) => set({ communityLoaded }),
    setCommunityLoading: (communityLoading) => set({ communityLoading }),

    // 跨库全局搜索
    setGlobalSearchQuery: (query) => set({ globalSearchQuery: query }),
    clearGlobalSearch: () => set((state) => ({
        globalSearchSeq: state.globalSearchSeq + 1,
        globalSearchQuery: '',
        globalSearchHits: [],
        globalSearching: false,
        globalSearchRan: false,
        globalSearchUnindexed: false,
        globalSearchRateLimited: false,
        globalSearchProgress: { current: 0, total: 0 },
    })),

    searchGlobalPlugins: async (i18n, query, options) => {
        const q = (query || '').trim().toLowerCase();

        // 序号守卫：任何一次新检索（包括空查询）都会让仍在途的旧检索结果作废，
        // 保证界面永远只显示"最新一次检索"的结果，避免旧结果覆盖新结果
        const seq = get().globalSearchSeq + 1;

        // 空查询：直接回到初始态
        if (!q) {
            set({
                globalSearchSeq: seq,
                globalSearchHits: [],
                globalSearching: false,
                globalSearchRan: false,
                globalSearchUnindexed: false,
                globalSearchRateLimited: false,
                globalSearchProgress: { current: 0, total: 0 },
            });
            return;
        }

        const { communityRegistry, communityStats, manifestCache } = get();
        if (communityRegistry.length === 0) {
            set({ globalSearchSeq: seq, globalSearching: false, globalSearchRan: true, globalSearchHits: [] });
            return;
        }

        set({ globalSearchSeq: seq, globalSearching: true, globalSearchRan: true, globalSearchRateLimited: false, globalSearchProgress: { current: 0, total: 0 } });

        // 过期判定：一旦有更新的检索发起，本次检索即视为过期
        const isStale = () => get().globalSearchSeq !== seq;

        try {
            const repos = communityStats?.repos || {};
            const allAddresses = communityRegistry.map((item) => item.repoAddress);

            // 1) 先用 stats.json 里已有的 pluginIds 索引做零成本预筛（不消耗 API 请求）
            const indexed = communityRegistry.filter((item) => {
                const ids = repos[item.repoAddress]?.pluginIds;
                return Array.isArray(ids) && ids.some((id) => String(id).toLowerCase().includes(q));
            });

            // 索引未命中时，只可能是标题/别名类匹配，需要各仓库的目录文件。
            // 若全部仓库的目录缓存仍然有效，直接走本地匹配，无需请求也无需用户确认
            const now = Date.now();
            const allCacheWarm = allAddresses.length > 0 && allAddresses.every((address) => {
                const cached = manifestCache[address];
                return cached && now - cached.fetchedAt <= MANIFEST_CACHE_TTL;
            });

            // 索引未命中且缓存未预热 → 交给用户确认后再发起深度搜索
            const unindexed = indexed.length === 0;
            if (unindexed && !options?.deep && !allCacheWarm) {
                if (isStale()) return;
                set({
                    globalSearchHits: [],
                    globalSearchUnindexed: true,
                    globalSearching: false,
                    globalSearchProgress: { current: 0, total: 0 },
                });
                return;
            }

            const targets = unindexed ? allAddresses : indexed.map((item) => item.repoAddress);

            // 2) 拉取候选仓库的 metadata.json（带会话缓存 + 并发限流）
            const needFetch = targets.filter((address) => {
                const cached = manifestCache[address];
                return !cached || now - cached.fetchedAt > MANIFEST_CACHE_TTL;
            });

            const nextCache: Record<string, RepoManifestCacheEntry> = {};
            let finished = 0;
            let rateLimited = false;
            set({ globalSearchProgress: { current: 0, total: needFetch.length } });

            for (let i = 0; i < needFetch.length; i += MANIFEST_FETCH_BATCH) {
                // 已有更新的检索发起，剩余请求没必要继续消耗 API 额度
                if (isStale()) break;
                const batch = needFetch.slice(i, i + MANIFEST_FETCH_BATCH);
                await Promise.all(batch.map(async (address) => {
                    const [owner, repo] = address.split('/');
                    if (!owner || !repo) return;
                    try {
                        const res = await i18n.api.github.getFileContentWithFallback(owner, repo, 'metadata.json');
                        if (res.isRateLimit) {
                            // GitHub 限流：本轮检索已无法拿到完整结果，标记后立即放弃剩余仓库
                            rateLimited = true;
                            return;
                        }
                        if (res.state && Array.isArray(res.data)) {
                            nextCache[address] = { entries: res.data as ManifestEntry[], fetchedAt: Date.now() };
                        }
                    } catch (error) {
                        console.error(`[GlobalSearch] failed to fetch metadata.json from ${address}`, error);
                    } finally {
                        finished += 1;
                        if (!isStale()) {
                            set({ globalSearchProgress: { current: finished, total: needFetch.length } });
                        }
                    }
                }));
                // 批次之间留出间隔，降低触发 GitHub 速率限制的概率
                if (i + MANIFEST_FETCH_BATCH < needFetch.length) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }

            // 回写缓存：与检索结果解耦——即使本次检索已过期作废，抓到的目录数据依然有效，照样落袋，
            // 避免用户改个关键词就丢弃整批已抓取结果、重新烧一遍 GitHub API 额度
            const mergedCache: Record<string, RepoManifestCacheEntry> = { ...get().manifestCache, ...nextCache };
            if (Object.keys(nextCache).length > 0) {
                set({ manifestCache: mergedCache });
            }

            // 限流中止：与其展示"N 条匹配"的残缺结果误导用户，不如明确告知限流，
            // 已抓到的部分数据已在上面落袋，重试时不会再消耗这部分额度
            if (rateLimited) {
                if (isStale()) return;
                console.warn('[GlobalSearch] aborted: GitHub rate limited');
                set({
                    globalSearchHits: [],
                    globalSearching: false,
                    globalSearchRateLimited: true,
                    globalSearchProgress: { current: 0, total: 0 },
                });
                return;
            }

            // 只有最新一次检索才继续匹配并写入结果，旧检索到此作废
            if (isStale()) return;

            // 3) 在候选仓库的目录中匹配插件 ID / 标题（并按语种过滤）
            const language = options?.language;
            const hits: GlobalSearchHit[] = [];
            for (const address of targets) {
                const cached = mergedCache[address];
                if (!cached) continue;
                for (const entry of cached.entries) {
                    if (language && language !== 'all' && entry.language !== language) continue;
                    const matchId = entry.plugin?.toLowerCase().includes(q);
                    const matchTitle = entry.title?.toLowerCase().includes(q);
                    if (matchId || matchTitle) {
                        hits.push({ repoAddress: address, entry });
                    }
                }
            }

            // 4) 排序：官方/精选仓库优先 → 星标高 → 最近更新
            const registryMeta = new Map(communityRegistry.map((item) => [item.repoAddress, item]));
            const weightOf = (address: string) => {
                const meta = registryMeta.get(address);
                return (meta?.isOfficial ? 2 : 0) + (meta?.isFeatured ? 1 : 0);
            };

            hits.sort((a, b) => {
                const wa = weightOf(a.repoAddress);
                const wb = weightOf(b.repoAddress);
                if (wa !== wb) return wb - wa;

                const sa = repos[a.repoAddress]?.stars || 0;
                const sb = repos[b.repoAddress]?.stars || 0;
                if (sa !== sb) return sb - sa;

                return (b.entry.updated_at || '').localeCompare(a.entry.updated_at || '');
            });

            // 只有最新一次检索才允许写入结果，旧检索到此作废
            if (isStale()) return;
            set({
                globalSearchHits: hits,
                globalSearchUnindexed: false,
                globalSearching: false,
            });
        } catch (error) {
            console.error('[GlobalSearch] search failed', error);
            if (!isStale()) {
                set({ globalSearching: false });
            }
        }
    },

    // 个人仓库
    setRepoDataLoaded: (repoDataLoaded) => set({ repoDataLoaded }),
    setRepoInitialized: (repoInitialized) => set({ repoInitialized }),
    setRepoChecking: (repoChecking) => set({ repoChecking }),
    setRepoManifest: (repoManifest) => set({ repoManifest }),
    setGithubUser: (githubUser) => set({ githubUser }),
    setIsForking: (isForking) => set({ isForking }),
    setCanCreateRepo: (canCreateRepo) => set({ canCreateRepo }),
    setRepoNameInput: (repoNameInput) => set({ repoNameInput }),
    setRepoDescriptionInput: (repoDescriptionInput) => set({ repoDescriptionInput }),
    setMyRepoInfo: (myRepoInfo) => set({ myRepoInfo }),
    setMyRepoReadme: (myRepoReadme) => set({ myRepoReadme }),

    // 搜索
    setSearchQuery: (query) => set((state) => ({
        searchParams: { ...state.searchParams, query, page: 1 }
    })),
    setSearchLanguage: (language) => set((state) => ({
        searchParams: { ...state.searchParams, language, page: 1 }
    })),
    setSearchPage: (page) => set((state) => ({
        searchParams: { ...state.searchParams, page }
    })),

    // 翻译列表
    setTotalPages: (totalPages) => set({ totalPages }),

    // 下载页
    setTargetRepoAddress: (targetRepoAddress) => set({ targetRepoAddress }),
    setTargetRepoStars: (targetRepoStars) => set({ targetRepoStars }),
    setTargetManifest: (targetManifest) => set({ targetManifest }),
    setTargetRepoReadme: (targetRepoReadme) => set({ targetRepoReadme }),
    setSavedRepos: (savedRepos) => set({ savedRepos }),
    addSavedRepo: (address) => set((state) => ({ savedRepos: Array.from(new Set([...state.savedRepos, address])) })),
    removeSavedRepo: (address) => set((state) => ({ savedRepos: state.savedRepos.filter(a => a !== address) })),

    // 上传表单
    setUploadType: (type) => set({ uploadType: type }),
    setSelectedPluginId: (pluginId) => set({ selectedPluginId: pluginId, localFiles: [], selectedSourceId: '', uploadForm: { plugin_id: pluginId, title: '', description: '', version: '' } }),
    setSelectedSourceId: (sourceId) => set({ selectedSourceId: sourceId }),
    setUploadForm: (form) => set((state) => ({
        uploadForm: { ...state.uploadForm, ...form }
    })),
    setLocalFiles: (files) => set({ localFiles: files }),
    resetUploadForm: () => set({
        uploadForm: initialState.uploadForm,
        selectedPluginId: '',
        selectedSourceId: '',
        localFiles: [],
    }),

    // 更新检查
    setOutdatedSources: (outdatedSources) => set({ outdatedSources }),
    setIsCheckingUpdates: (isCheckingUpdates) => set({ isCheckingUpdates }),

    // 加载状态
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),

    // 历史回滚
    setHistoryDialogEntryId: (historyDialogEntryId) => set({ historyDialogEntryId }),

    // 备份/恢复
    setBackupDialogOpen: (backupDialogOpen) => set({ backupDialogOpen }),
    setBackupDialogMode: (backupDialogMode) => set({ backupDialogMode }),
    setBackupProgress: (backupProgress) => set({ backupProgress }),

    // 差异对比
    setDiffDialogSourceId: (diffDialogSourceId) => set({ diffDialogSourceId }),

    // 权限管理
    setIsAdmin: (isAdmin) => set({ isAdmin }),
    fetchGithubUser: async (i18n) => {
        const { githubUser, setGithubUser, setLoading, setIsAdmin, setCanCreateRepo } = get();
        const token = i18n.settings.shareToken;
        if (!token || githubUser) return;

        setLoading(true);
        try {
            const res = await i18n.api.github.getUser();
            if (res.state) {
                const user = {
                    login: res.data.login,
                    id: res.data.id,
                    avatar_url: res.data.avatar_url,
                    name: res.data.name,
                    followers: res.data.followers,
                    following: res.data.following,
                    public_repos: res.data.public_repos,
                    created_at: res.data.created_at,
                    bio: res.data.bio,
                };
                setGithubUser(user);
                setIsAdmin(user.login === i18n.api.github.owner);

                // 解析权限
                const scopes: string[] = res.scopes || [];
                setCanCreateRepo(scopes.includes('public_repo') || scopes.includes('repo'));
            }
        } catch (e) {
            console.error('Failed to fetch github user', e);
        } finally {
            setLoading(false);
        }
    },

    fetchCommunityRegistry: async (i18n) => {
        const { communityLoading, setCommunityLoading, setCommunityRegistry, setCommunityStats, setCommunityLoaded } = get();
        if (communityLoading) return;

        setCommunityLoading(true);
        try {
            const owner = i18n.api.github.owner;
            const repo = i18n.api.github.repo;

            // 并发加载 registry.json 和 stats.json
            const [registryRes, statsRes] = await Promise.all([
                i18n.api.github.getFileContentWithFallback(owner, repo, 'registry.json'),
                i18n.api.github.getFileContentWithFallback(owner, repo, 'stats.json'),
            ]);

            // 解析 registry.json
            if (registryRes.state && registryRes.data) {
                if (Array.isArray(registryRes.data)) {
                    setCommunityRegistry(registryRes.data);
                }
            }

            // 解析 stats.json
            if (statsRes.state && statsRes.data) {
                if (statsRes.data && typeof statsRes.data === 'object') {
                    setCommunityStats(statsRes.data);
                }
            }

            if (registryRes.state || statsRes.state) {
                setCommunityLoaded(true);
            }
        } catch (error) {
            console.error('Failed to fetch community registry', error);
        } finally {
            setCommunityLoading(false);
        }
    },

    pushRegistryToCloud: async (i18n) => {
        const { communityRegistry, isPushing } = get();
        if (isPushing) return false;

        set({ isPushing: true });
        try {
            const owner = i18n.api.github.owner;
            const repo = i18n.api.github.repo;
            const path = 'registry.json';

            // 1. 序列化并 Base64 编码
            const contentJson = JSON.stringify(communityRegistry, null, 2);
            const contentBase64 = Buffer.from(contentJson, 'utf-8').toString('base64');

            // 2. 上传文件
            const res = await i18n.api.github.uploadFile(
                owner, repo, path, contentBase64,
                `Update registry.json from Admin Panel (${new Date().toLocaleString()})`
            );

            if (res.state) {
                return true;
            } else {
                console.error('Push to Registry failed:', res.data);
                return false;
            }
        } catch (error) {
            console.error('Push registry error:', error);
            return false;
        } finally {
            set({ isPushing: false });
        }
    },

    // 注册表管理
    updateRegistryItem: (repoAddress, data) => set((state) => ({
        communityRegistry: state.communityRegistry.map(item =>
            item.repoAddress === repoAddress ? { ...item, ...data } : item
        )
    })),

    // 贡献者鸣谢
    setContributors: (contributors) => set({ contributors }),
    setContributorsLoaded: (contributorsLoaded) => set({ contributorsLoaded }),
    addContributor: (entry) => set((state) => ({ contributors: [...state.contributors, entry] })),
    removeContributor: (name, category) => set((state) => ({
        contributors: state.contributors.filter(c => !(c.name === name && c.category === category))
    })),
    updateContributor: (name, category, data) => set((state) => ({
        contributors: state.contributors.map(c =>
            c.name === name && c.category === category ? { ...c, ...data } : c
        )
    })),
    fetchContributors: async (i18n) => {
        const { contributorsLoaded, setContributors, setContributorsLoaded } = get();
        if (contributorsLoaded) return;
        try {
            const owner = i18n.api.github.owner;
            const repo = i18n.api.github.repo;
            const res = await i18n.api.github.getFileContentWithFallback(owner, repo, 'contributors.json');
            if (res.state && res.data) {
                const data = res.data;
                if (data.contributors && Array.isArray(data.contributors)) {
                    setContributors(data.contributors);
                }
            }
            setContributorsLoaded(true);
        } catch (error) {
            console.error('Failed to fetch contributors.json', error);
            setContributorsLoaded(true);
        }
    },
    pushContributorsToCloud: async (i18n) => {
        const { contributors, isPushing } = get();
        if (isPushing) return false;
        set({ isPushing: true });
        try {
            const owner = i18n.api.github.owner;
            const repo = i18n.api.github.repo;
            const path = 'contributors.json';
            const contentJson = JSON.stringify({ contributors }, null, 2);
            const contentBase64 = Buffer.from(contentJson, 'utf-8').toString('base64');
            const res = await i18n.api.github.uploadFile(
                owner, repo, path, contentBase64,
                `Update contributors.json from Admin Panel (${new Date().toLocaleString()})`
            );
            if (res.state) return true;
            console.error('Push contributors failed:', res.data);
            return false;
        } catch (error) {
            console.error('Push contributors error:', error);
            return false;
        } finally {
            set({ isPushing: false });
        }
    },

    // 重置 (保留下载页地址簿和当前目标状态)
    reset: () => set((state) => ({
        ...initialState,
        refreshVersion: state.refreshVersion + 1,
        savedRepos: state.savedRepos,
        targetRepoAddress: state.targetRepoAddress,
        targetManifest: state.targetManifest,
        targetRepoReadme: state.targetRepoReadme,
        communityRegistry: state.communityRegistry,
        communityStats: state.communityStats,
        communityLoaded: state.communityLoaded,
        manifestCache: state.manifestCache,
        outdatedSources: state.outdatedSources,
        contributors: state.contributors,
        contributorsLoaded: state.contributorsLoaded,
    })),
}));

// 导出带选择器的 Store
export const useCloudStore = createSelectors(useCloudStoreBase);
