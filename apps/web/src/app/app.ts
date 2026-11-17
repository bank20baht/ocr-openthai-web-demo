import { ChangeDetectionStrategy, Component } from '@angular/core'
import type { ShellNavItem } from 'bank20baht-ui'
import { BAHT_UI } from 'bank20baht-ui-angular'
import { ScanPage } from './modules/scan/scan.page'

/** The frame: brand, theme switch, the scan page. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BAHT_UI, ScanPage],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly items: ShellNavItem[] = [{ key: 'scan', label: 'สแกนเอกสาร', href: '/' }]
}
