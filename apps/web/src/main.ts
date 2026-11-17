import { bootstrapApplication } from '@angular/platform-browser'
import { setLocale } from 'bank20baht-ui'
import { App } from './app/app'
import { appConfig } from './app/app.config'

// Built-in strings (validation, file picker) in Thai, before any <baht-*> renders.
setLocale('th')

bootstrapApplication(App, appConfig).catch((err: unknown) => {
  console.error(err)
})
