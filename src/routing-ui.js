(() => {
  'use strict';

  function createRoutingAssistantUi({ el, view = 'all', kind = 'website' }) {
    const actionOptions = () => [
      el('option', { textContent: '\u9009\u62e9\u7ebf\u8def\u6216\u8282\u70b9', attrs: { value: 'proxy' } }),
      el('option', { textContent: '\u76f4\u8fde\uff08\u4e0d\u8d70\u4ee3\u7406\uff09', attrs: { value: 'direct' } }),
      el('option', { textContent: '\u963b\u6b62\u8bbf\u95ee', attrs: { value: 'reject' } })
    ];
    const targetField = (id) => el('label', { className: 'routing-field routing-proxy-target-field' }, [
      el('span', { textContent: '\u7ebf\u8def\u6216\u8282\u70b9' }),
      el('select', { id, attrs: { 'aria-label': '\u7ebf\u8def\u6216\u8282\u70b9' } }, [])
    ]);
    const scopeField = (id) => el('label', { className: 'routing-field routing-scope-field' }, [
      el('span', { textContent: '\u4f5c\u7528\u8303\u56f4' }),
      el('select', { id, attrs: { 'aria-label': '\u89c4\u5219\u4f5c\u7528\u8303\u56f4' } }, [
        el('option', { textContent: '\u6240\u6709\u8ba2\u9605', attrs: { value: 'global' } }),
        el('option', { textContent: '\u4ec5\u5f53\u524d\u8ba2\u9605', attrs: { value: 'profile' } })
      ])
    ]);
    const kindButton = (buttonKind, title, detail) => el('button', {
      className: buttonKind === kind ? 'active' : '',
      dataset: { routingKind: buttonKind },
      attrs: { type: 'button' }
    }, [
      el('b', { textContent: title }),
      el('small', { className: 'sr-only', textContent: detail })
    ]);
    const panelHeader = (title, detail) => el('div', { className: 'routing-panel-title' }, [
      el('b', { textContent: title }),
      el('small', { textContent: detail })
    ]);
    const systemEntry = (title, detail) => el('div', { className: 'routing-system-entry' }, [
      el('b', { textContent: title }),
      el('small', { textContent: detail })
    ]);

    const assistant = el('div', {
      className: 'routing-assistant',
      dataset: { view, kind },
      attrs: { 'aria-label': '\u5206\u6d41\u89c4\u5219\u8349\u7a3f\u9884\u89c8' }
    }, [
      el('div', { className: 'routing-builder' }, [
        el('nav', { className: 'routing-kind-list', attrs: { 'aria-label': '\u9009\u62e9\u89c4\u5219\u5165\u53e3' } }, [
          kindButton('website', '\u7f51\u7ad9\u89c4\u5219', '\u8f93\u5165 youtube.com \u8fd9\u7c7b\u57df\u540d'),
          kindButton('app', '\u5e94\u7528\u89c4\u5219', '\u9009\u62e9 Telegram.exe \u8fd9\u7c7b\u7a0b\u5e8f'),
          kindButton('system', '\u7cfb\u7edf\u89c4\u5219', '\u67e5\u770b Aegos \u81ea\u52a8\u7ef4\u62a4\u7684\u89c4\u5219')
        ]),
        el('section', { className: 'routing-builder-panel is-active', id: 'routingPanelWebsite', dataset: { routingPanel: 'website' }, attrs: { 'aria-label': '\u7f51\u7ad9\u89c4\u5219\u5411\u5bfc' } }, [
          el('label', { className: 'routing-field' }, [
            el('span', { textContent: '\u76ee\u6807\u7f51\u7ad9' }),
            el('input', { id: 'routingWebsiteInput', attrs: { placeholder: 'youtube.com \u6216 https://www.youtube.com/watch?v=...', autocomplete: 'off', spellcheck: 'false' } })
          ]),
          el('div', { className: 'routing-service-presets', attrs: { 'aria-label': '\u5e38\u7528\u670d\u52a1\u89c4\u5219' } }, [
            el('span', { textContent: '\u5e38\u7528\u670d\u52a1' }),
            el('button', { className: 'ghost compact', dataset: { routingService: 'youtube' }, attrs: { type: 'button' }, textContent: 'YouTube' }),
            el('button', { className: 'ghost compact', dataset: { routingService: 'telegram' }, attrs: { type: 'button' }, textContent: 'Telegram' }),
            el('button', { className: 'ghost compact', dataset: { routingService: 'netflix' }, attrs: { type: 'button' }, textContent: 'Netflix' })
          ]),
          el('div', { className: 'routing-draft-form' }, [
            el('label', { className: 'routing-field' }, [
              el('span', { textContent: '\u8fd9\u4e2a\u7f51\u7ad9' }),
              el('select', { id: 'routingWebsiteAction', attrs: { 'aria-label': '\u8d70\u5411' } }, actionOptions())
            ]),
            targetField('routingWebsiteTargetSelect'),
            scopeField('routingWebsiteScope'),
            el('button', { id: 'previewWebsiteRuleBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u9884\u89c8\u89c4\u5219' })
          ]),
          el('p', { id: 'routingDraftPreview', className: 'routing-draft-preview', textContent: '\u8f93\u5165\u7f51\u7ad9\u540e\uff0c\u8fd9\u91cc\u4f1a\u544a\u8bc9\u4f60\u5b83\u5c06\u8d70\u54ea\u6761\u7ebf\u8def\u3002' })
        ]),
        el('section', { className: 'routing-builder-panel', id: 'routingPanelApp', dataset: { routingPanel: 'app' }, attrs: { 'aria-label': '\u5e94\u7528\u89c4\u5219\u5411\u5bfc' } }, [
          el('label', { className: 'routing-field' }, [
            el('span', { textContent: '\u76ee\u6807\u5e94\u7528' }),
            el('input', { id: 'routingAppInput', attrs: { placeholder: 'Telegram.exe \u6216 C:\\Program Files\\App\\app.exe', autocomplete: 'off', spellcheck: 'false' } }),
            el('small', { className: 'sr-only', textContent: '\u4e0d\u5fc5\u77e5\u9053\u8fdb\u7a0b\u89c4\u5219\uff1b\u8f93\u5165 Telegram \u4e5f\u4f1a\u81ea\u52a8\u8865\u6210 Telegram.exe\u3002' })
          ]),
          el('div', { className: 'routing-draft-form' }, [
            el('label', { className: 'routing-field' }, [
              el('span', { textContent: '\u8fd9\u4e2a\u5e94\u7528' }),
              el('select', { id: 'routingAppAction', attrs: { 'aria-label': '\u8d70\u5411' } }, actionOptions())
            ]),
            targetField('routingAppTargetSelect'),
            scopeField('routingAppScope'),
            el('button', { id: 'previewAppRuleBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u9884\u89c8\u89c4\u5219' })
          ]),
          el('p', { id: 'routingAppDraftPreview', className: 'routing-draft-preview', textContent: '\u8f93\u5165\u5e94\u7528\u540e\uff0c\u8fd9\u91cc\u4f1a\u544a\u8bc9\u4f60\u5b83\u5c06\u8d70\u54ea\u6761\u7ebf\u8def\u3002' })
        ]),
        el('section', { className: 'routing-builder-panel', id: 'routingPanelSystem', dataset: { routingPanel: 'system' } }, [
          panelHeader('\u7cfb\u7edf\u89c4\u5219', '\u8fd9\u4e9b\u89c4\u5219\u7531 Aegos \u81ea\u52a8\u7ef4\u62a4\uff0c\u7528\u6765\u4fdd\u8bc1\u68c0\u6d4b\u3001\u8bca\u65ad\u548c\u9632\u6cc4\u9732\u884c\u4e3a\u53ef\u63a7\u3002'),
          el('div', { className: 'routing-system-entry-grid' }, [
            systemEntry('\u843d\u5730 IP \u67e5\u8be2', '\u8ba9 IP \u68c0\u6d4b\u8d70\u5f53\u524d\u8282\u70b9\uff0c\u4e0d\u6539\u53d8\u4f60\u7684\u8fde\u63a5\u3002'),
            systemEntry('Aegos \u81ea\u8eab\u670d\u52a1', '\u4fdd\u8bc1\u8ba2\u9605\u3001\u8bca\u65ad\u3001\u72b6\u6001\u67e5\u8be2\u80fd\u88ab\u8bc6\u522b\u548c\u89e3\u91ca\u3002'),
            systemEntry('\u9632\u6cc4\u9732\u4fdd\u62a4', '\u9632\u6b62\u68c0\u6d4b\u6216\u7cfb\u7edf\u63a5\u7ba1\u65f6\u51fa\u73b0\u4e0d\u53ef\u89c1\u7684\u7ed5\u8fc7\u3002')
          ]),
          el('p', { id: 'routingSystemEntryHint', className: 'routing-draft-preview ok', textContent: '\u7cfb\u7edf\u89c4\u5219\u53ea\u8bfb\uff0c\u4e0d\u4f1a\u8981\u6c42\u4f60\u624b\u52a8\u7f16\u8f91\uff1b\u5982\u679c\u5f71\u54cd\u7528\u6237\u89c4\u5219\uff0cAegos \u4f1a\u8bf4\u660e\u539f\u56e0\u3002' }),
          el('button', { id: 'routingShowSystemRulesBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u67e5\u770b\u7cfb\u7edf\u89c4\u5219\u660e\u7ec6' })
        ])
      ]),
      el('section', { id: 'routingDraftListCard', className: 'routing-draft-card routing-draft-list-card hidden', attrs: { 'aria-live': 'polite' } }, [
        el('div', { className: 'routing-draft-head' }, [
          el('div', {}, [
            el('b', { id: 'routingDraftListTitle', textContent: '\u8349\u7a3f\u4e0e\u9a8c\u8bc1' }),
            el('small', { id: 'routingDraftListHint', textContent: '\u672a\u5e94\u7528\u7684\u53d8\u66f4' })
          ])
        ]),
        el('div', { id: 'routingDraftList', className: 'routing-draft-list' }, []),
        el('p', { id: 'routingConflictSummary', className: 'routing-draft-preview', textContent: '\u6682\u65e0\u8349\u7a3f\u3002' }),
        el('div', { className: 'routing-draft-actions' }, [
          el('button', { id: 'undoRoutingDraftBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u64a4\u9500\u4e0a\u4e00\u6761' }),
          el('button', { id: 'verifyAllRoutingDraftsBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u9a8c\u8bc1\u5168\u90e8' }),
          el('button', { id: 'applyRoutingDraftsBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u5e94\u7528\u8349\u7a3f' }),
          el('button', { id: 'undoRoutingApplyBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u64a4\u9500\u6700\u8fd1\u5e94\u7528' })
        ])
      ]),
      el('details', { id: 'routingRuleTestCard', className: 'routing-draft-card routing-test-card' }, [
        el('summary', { className: 'routing-draft-head routing-test-summary' }, [
          el('div', {}, [
            el('b', { textContent: '\u6d4b\u8bd5\u5df2\u6709\u89c4\u5219' }),
            el('small', { textContent: '\u53ef\u9009\uff1a\u67e5\u770b\u7f51\u7ad9\u4f1a\u8d70\u54ea\u6761\u7ebf\u8def' })
          ])
        ]),
        el('div', { className: 'routing-draft-form wide routing-test-form' }, [
          el('label', { className: 'routing-field' }, [
            el('span', { textContent: '\u6d4b\u8bd5\u7f51\u7ad9' }),
            el('input', { id: 'routingRuleTestInput', attrs: { placeholder: '\u4f8b\u5982 youtube.com', autocomplete: 'off', spellcheck: 'false' } })
          ]),
          el('button', { id: 'testRoutingRuleBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u6d4b\u8bd5\u5f53\u524d\u89c4\u5219' })
        ]),
        el('div', { className: 'routing-test-examples', attrs: { 'aria-label': '\u89c4\u5219\u6d4b\u8bd5\u793a\u4f8b' } }, [
          el('span', { textContent: '\u793a\u4f8b' }),
          el('button', { className: 'ghost compact', dataset: { routingTestExample: 'youtube.com' }, attrs: { type: 'button' }, textContent: 'youtube.com' }),
          el('button', { className: 'ghost compact', dataset: { routingTestExample: 'openai.com' }, attrs: { type: 'button' }, textContent: 'openai.com' }),
          el('button', { className: 'ghost compact', dataset: { routingTestExample: 'telegram.org' }, attrs: { type: 'button' }, textContent: 'telegram.org' })
        ]),
        el('p', { id: 'routingRuleTestResult', className: 'routing-draft-preview', textContent: '\u8f93\u5165\u7f51\u7ad9\u540e\uff0cAegos \u4f1a\u544a\u8bc9\u4f60\u5f53\u524d\u4f1a\u547d\u4e2d\u54ea\u6761\u89c4\u5219\u3002' })
      ]),
      el('section', { id: 'routingApplyStatus', className: 'routing-apply-status hidden', attrs: { 'aria-live': 'polite' } }, [])
    ]);
    const detail = el('section', {
      id: 'routingSummaryDetail',
      className: 'routing-summary-detail',
      attrs: { 'aria-live': 'polite' }
    }, []);

    return { assistant, detail };
  }

  window.AegosRoutingUi = Object.freeze({ createRoutingAssistantUi });
})();
