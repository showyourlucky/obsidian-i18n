import * as path from 'path';
import * as fs from 'fs-extra';
import { t } from '../locales';
import I18N from '../main';
import { activateIMT, deactivateIMT, AstTranslator, RegexTranslator } from '../utils';
import { buildEffectiveSettings } from '../utils/translator/effective-settings';
import { MANAGER_VIEW_TYPE } from '../views/manager/manager-view';
import { ImmersiveWindowManager } from '../utils/ui/immersive-windows';

export class CoreManager {
    private i18n: I18N;

    // [更新相关] - 插件版本更新状态
    updatesMark = false;        // [变量] 是否存在更新标记
    updatesVersion: string;     // [变量] 更新版本


    // [变量] 样式
    css: string;

    i18nReviewEl: HTMLElement;

    // [管理相关] - 翻译器实例复用
    // 按插件 ID 键控：插件专属提取规则 (extract-rules sidecar) 只对该插件生效，
    // 提取/注入/诊断必须用同一份「全局+插件级合并后的 settings」，口径不一致会出现假翻译。
    private _translatorCache = new Map<string, { ast: AstTranslator; regex: RegexTranslator }>();
    private immersiveWindows: ImmersiveWindowManager | null = null;
    private immersiveDisposed = false;

    constructor(i18n: I18N) {
        this.i18n = i18n;
    }

    // [UI] 注册功能区图标
    public setupRibbonIcons() {
        // [功能] 翻译
        this.i18n.addRibbonIcon('i18n_translate', t('common.i18n'), () => {
            this.i18n.view.activateView(MANAGER_VIEW_TYPE);
        });
    }

    public async firstRun() {
    }

    public async checkUpdates() {
        // 使用 GitHub API 获取最新 Release
        const owner = 'eondrcode'; // 插件所有者
        const repo = 'obsidian-i18n'; // 插件仓库名
        const res = await this.i18n.api.github.getLatestRelease(owner, repo);

        if (res.state) {
            const latestVersion = res.data.tag_name.replace(/^v/, '');
            if (this.i18n.manifest.version !== latestVersion) {
                const noticeStr = `${t('Settings.Basis.CheckUpdateNotice')}(${latestVersion})\n${res.data.body || ''}`;
                this.i18n.notice.primaryPrefix(t('Settings.Basis.CheckUpdatePrefix'), noticeStr, 15000);
                this.updatesMark = true;
                this.updatesVersion = latestVersion;
            }
        }
    }




    // 激活沉浸式翻译
    public async activateIMT() {
        if (this.immersiveDisposed) return;
        this.i18n.settings.modeImt = true;
        await this.i18n.saveSettings();
        if (this.immersiveDisposed || !this.i18n.settings.modeImt) return;

        if (!this.immersiveWindows) {
            this.immersiveWindows = new ImmersiveWindowManager(this.i18n.app, {
                activate: (win) => activateIMT(this.i18n.settings, win),
                deactivate: (win) => deactivateIMT(win),
                onError: (error) => this.reportImmersiveError(error)
            });
        }
        await this.immersiveWindows.start();
    }

    // 停用沉浸式翻译
    public async deactivateIMT() {
        this.immersiveWindows?.stop();
        this.i18n.settings.modeImt = false;
        await Promise.all([this.i18n.saveSettings(), deactivateIMT()]);
    }

    /** 卸载只释放运行时，不改写用户的启用偏好。 */
    public async disposeIMT() {
        this.immersiveDisposed = true;
        this.immersiveWindows?.stop();
        await deactivateIMT();
    }

    public reportImmersiveError(error: unknown) {
        this.i18n.logger.error('沉浸式翻译初始化或清理失败', error);
        this.i18n.notice.errorPrefix(t('Settings.Immersive.Title'), t('Settings.Immersive.LoadFailed'));
    }

    public getCss() {
        //@ts-ignore
        const stylesDoc = path.join(path.join(path.normalize(this.i18n.app.vault.adapter.getBasePath()), this.i18n.manifest.dir), 'styles.css');
        this.css = fs.readFileSync(stylesDoc).toString();
        this.i18n.css = this.css;

        try {
            this.i18n.sharedStyleSheet = new CSSStyleSheet();
            this.i18n.sharedStyleSheet.replaceSync(this.css);
        } catch (e) {
            this.i18n.logger.error('Failed to precompile CSSStyleSheet:', e);
        }
    }

    /**
     * 获取指定插件的「生效提取设置」快照：全局 settings 与该插件专属规则 (extract-rules
     * sidecar) 的并集。不传 pluginId 时返回全局原对象。
     * 返回值仅作只读快照使用，禁止写回 settings。
     */
    public getEffectiveSettings(pluginId?: string) {
        if (!pluginId) return this.i18n.settings;
        return buildEffectiveSettings(this.i18n.settings, this.i18n.sourceManager.getPluginExtractRules(pluginId));
    }

    private getTranslatorPair(pluginId?: string): { ast: AstTranslator; regex: RegexTranslator } {
        const key = pluginId ?? '';
        let pair = this._translatorCache.get(key);
        if (!pair) {
            const settings = this.getEffectiveSettings(pluginId);
            pair = {
                ast: new AstTranslator(settings),
                regex: new RegexTranslator(settings),
            };
            this._translatorCache.set(key, pair);
        }
        return pair;
    }

    /**
     * 获取 AST 翻译器实例 (懒加载/复用)。
     * 传入 pluginId 时使用该插件的生效提取规则 (全局 + 插件专属并集)。
     */
    public getAstTranslator(pluginId?: string): AstTranslator {
        return this.getTranslatorPair(pluginId).ast;
    }

    /**
     * 获取 Regex 翻译器实例 (懒加载/复用)。pluginId 语义同 getAstTranslator。
     */
    public getRegexTranslator(pluginId?: string): RegexTranslator {
        return this.getTranslatorPair(pluginId).regex;
    }

    /**
     * 重置翻译器实例 (当设置变更等情况下调用)。
     * 传入 pluginId 仅清除该插件的缓存 (编辑专属规则后调用)；不传则全部清空。
     */
    public resetTranslators(pluginId?: string) {
        if (!pluginId) {
            this._translatorCache.clear();
        } else {
            this._translatorCache.delete(pluginId);
        }
    }

}
