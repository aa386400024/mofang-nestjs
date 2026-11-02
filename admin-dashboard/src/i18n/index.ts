import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

export const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('lang') || 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
})

export function setLang(lang: string) {
  i18n.global.locale.value = lang
  localStorage.setItem('lang', lang)
}
