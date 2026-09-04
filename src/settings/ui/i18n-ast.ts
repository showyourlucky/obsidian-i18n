import { Setting } from "obsidian"
import BaseSetting from "../base-setting"
import { t } from "src/locales";

export default class I18nAST extends BaseSetting {
    main(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ==============================
        // 1. 提取上下文配置
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.ConfigHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['astAssignments', 'astFunctions', 'astKeys']); }));

        // 变量赋值白名单
        new Setting(containerEl)
            .setName(t('Settings.Ast.AssignTitle'))
            .setDesc(t('Settings.Ast.AssignDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astAssignments || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.AssignPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astAssignments = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 3;
                text.inputEl.style.width = '100%';
            });

        // 函数调用白名单
        new Setting(containerEl)
            .setName(t('Settings.Ast.FuncTitle'))
            .setDesc(t('Settings.Ast.FuncDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astFunctions || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.FuncPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astFunctions = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 4;
                text.inputEl.style.width = '100%';
            });

        // 对象键名白名单
        new Setting(containerEl)
            .setName(t('Settings.Ast.KeyTitle'))
            .setDesc(t('Settings.Ast.KeyDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astKeys || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.KeyPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astKeys = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 4;
                text.inputEl.style.width = '100%';
            });

        // ==============================
        // 内容过滤规则 (正则)
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.RegexHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['astRejectRe', 'astValidRe', 'astNonTranslatableProps', 'astTranslatableProps']); }));

        // 排除正则列表
        new Setting(containerEl)
            .setName(t('Settings.Ast.RejectReTitle'))
            .setDesc(t('Settings.Ast.RejectReDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astRejectRe || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.RejectPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astRejectRe = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 6;
                text.inputEl.style.width = '100%';
            });

        // 有效特征正则
        new Setting(containerEl)
            .setName(t('Settings.Ast.ValidReTitle'))
            .setDesc(t('Settings.Ast.ValidReDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astValidRe || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.ValidPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astValidRe = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 3;
                text.inputEl.style.width = '100%';
            });

        // 非可译属性名
        new Setting(containerEl)
            .setName(t('Settings.Ast.NonTranslatablePropsTitle'))
            .setDesc(t('Settings.Ast.NonTranslatablePropsDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astNonTranslatableProps || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.NonTranslatablePropsPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astNonTranslatableProps = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 3;
                text.inputEl.style.width = '100%';
            });

        // 例外属性名
        new Setting(containerEl)
            .setName(t('Settings.Ast.TranslatablePropsTitle'))
            .setDesc(t('Settings.Ast.TranslatablePropsDesc'))
            .addTextArea(text => {
                text.setValue((this.settings.astTranslatableProps || []).join('\n'))
                    .setPlaceholder(t('Settings.Ast.TranslatablePropsPlaceholder'))
                    .onChange(async (value) => {
                        this.settings.astTranslatableProps = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                        await this.i18n.saveSettings();
                    });
                text.inputEl.rows = 2;
                text.inputEl.style.width = '100%';
            });

        // ==============================
        // 翻译安全策略
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.SafetyHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['astStrictMatch']); }));

        new Setting(containerEl)
            .setName(t('Settings.Ast.StrictTitle'))
            .setDesc(t('Settings.Ast.StrictDesc'))
            .addToggle(toggle => {
                toggle.setValue(!!this.settings.astStrictMatch)
                    .onChange(async (value) => {
                        this.settings.astStrictMatch = value;
                        await this.i18n.saveSettings();
                    });
            });

        // ==============================
        // 翻译提示词配置
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.PromptHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['llmAstPrompt']); }));

        // AST Prompt 配置
        const astPromptSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.PromptTitle'))
            .setDesc(t('Settings.Ast.PromptDesc'));

        astPromptSetting.addTextArea(text => {
            text.setValue(this.settings.llmAstPrompt || '')
                .setPlaceholder(t('Settings.Ast.PromptPlaceholder'))
                .onChange(async (value) => {
                    this.settings.llmAstPrompt = value;
                    await this.i18n.saveSettings();
                });

            // 样式调整
            text.inputEl.rows = 8;
            text.inputEl.addClass('i18n-settings-textarea');
            text.inputEl.style.width = '100%';
        });
    }
}
