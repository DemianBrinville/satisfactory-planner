import 'i18next'
import type { resources } from './index'

// claves de traducción tipadas: un `t('clave.inexistente')` da error al compilar
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: (typeof resources)['es']
  }
}
