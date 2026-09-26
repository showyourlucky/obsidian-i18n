import { Setting } from "obsidian"
import BaseSetting from "../base-setting"
import { t } from "src/locales";
import { attachCodeExample } from "./attach-code-example";
export default class I18nRE extends BaseSetting {
    main(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ==============================
        // 1. 正则参数配置
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Re.ParamsHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['reFlags', 'reLength']); }));

        // RE 标志
        new Setting(containerEl)
            .setName(t('Settings.Re.FlagTitle'))
            .setDesc(t('Settings.Re.FlagDesc'))
            .addText(cb => cb
                .setValue(this.settings.reFlags)
                .setPlaceholder(t('Settings.Re.FlagPlaceholder'))
                .onChange(async (value) => {
                    this.settings.reFlags = value;
                    await this.i18n.saveSettings();
                })
            );

        // RE 长度
        new Setting(containerEl)
            .setName(t('Settings.Re.LenTitle'))
            .setDesc(t('Settings.Re.LenDesc'))
            .addSlider(cb => cb
                .setDynamicTooltip()
                .setLimits(0, 3000, 100)
                .setValue(this.settings.reLength)
                .onChange(async (value) => {
                    this.settings.reLength = value
                    await this.i18n.saveSettings();
                })
            );


        // ==============================
        // 3. 正则匹配数据管理
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Re.DataHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['reDatas']); }));

        const dataEditSetting = new Setting(containerEl)
            .setName(t('Settings.Re.DataEditTitle'))
            .setDesc(t('Settings.Re.DataEditDesc'));
        attachCodeExample(dataEditSetting, t('Settings.Re.DataEditExample'), t('Settings.Re.ExampleToggle'));
        this.addStackedTextArea(dataEditSetting, {
            initial: (this.settings.reDatas || []).join('\n'),
            placeholder: t('Settings.Re.DataPlaceholder'),
            minRows: 6,
            onChange: async (value) => {
                this.settings.reDatas = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // ==============================
        // 4. 内容过滤规则 (正则)
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Re.RegexHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['reRejectRe', 'reValidRe']); }));

        const reRejectSetting = new Setting(containerEl)
            .setName(t('Settings.Re.RejectReTitle'))
            .setDesc(t('Settings.Re.RejectReDesc'));
        attachCodeExample(reRejectSetting, t('Settings.Re.RejectReExample'), t('Settings.Re.ExampleToggle'));
        this.addStackedTextArea(reRejectSetting, {
            initial: (this.settings.reRejectRe || []).join('\n'),
            placeholder: t('Settings.Re.RejectPlaceholder'),
            onChange: async (value) => {
                this.settings.reRejectRe = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        const reValidSetting = new Setting(containerEl)
            .setName(t('Settings.Re.ValidReTitle'))
            .setDesc(t('Settings.Re.ValidReDesc'));
        attachCodeExample(reValidSetting, t('Settings.Re.ValidReExample'), t('Settings.Re.ExampleToggle'));
        this.addStackedTextArea(reValidSetting, {
            initial: (this.settings.reValidRe || []).join('\n'),
            placeholder: t('Settings.Re.ValidPlaceholder'),
            onChange: async (value) => {
                this.settings.reValidRe = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // ==============================
        // 5. 翻译提示词配置 (正则)
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Re.PromptHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['llmRegexPrompt']); }));

        // Regex Prompt 配置
        const regexPromptSetting = new Setting(containerEl)
            .setName(t('Settings.Re.PromptTitle'))
            .setDesc(t('Settings.Re.PromptDesc'));

        // Prompt 内容通常较长，行数上限放宽到 30
        this.addStackedTextArea(regexPromptSetting, {
            initial: this.settings.llmRegexPrompt || '',
            placeholder: t('Settings.Re.PromptPlaceholder'),
            minRows: 8,
            maxRows: 30,
            onChange: async (value) => {
                this.settings.llmRegexPrompt = value;
                await this.i18n.saveSettings();
            },
        });
    }
}
