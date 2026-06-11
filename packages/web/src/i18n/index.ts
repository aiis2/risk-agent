import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCNCommon from './locales/zh-CN/common.json';
import enUSCommon from './locales/en-US/common.json';

export const i18n: I18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCNCommon },
    'en-US': { translation: enUSCommon }
  },
  lng: localStorage.getItem('uiLocale') ?? 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false }
});

i18n.on('languageChanged', (lng) => {
  try { localStorage.setItem('uiLocale', lng); } catch { /* ignore */ }
});
