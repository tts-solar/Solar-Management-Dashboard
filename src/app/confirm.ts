/** A styled yes/no dialog that replaces the browser's native confirm(). Resolves true on confirm. */

export interface ConfirmOpts {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean // red accent + red confirm button (destructive action)
}

const WARN_ICON =
  '<path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = el('dialog', o.danger ? 'confirm danger' : 'confirm')
    dlg.setAttribute('aria-label', o.title)

    const icon = el('div', 'confirm-ic')
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WARN_ICON}</svg>`

    const body = el('div', 'confirm-body')
    body.append(el('h2', '', o.title), el('p', 'confirm-msg', o.message))

    const actions = el('div', 'confirm-actions')
    const cancel = el('button', 'c-btn ghost', o.cancelText ?? 'ยกเลิก')
    cancel.type = 'button'
    const ok = el('button', o.danger ? 'c-btn danger' : 'c-btn primary', o.confirmText ?? 'ยืนยัน')
    ok.type = 'button'
    actions.append(cancel, ok)
    body.append(actions)

    const done = (v: boolean): void => {
      if (dlg.open) dlg.close()
      dlg.remove()
      resolve(v)
    }
    cancel.addEventListener('click', () => done(false))
    ok.addEventListener('click', () => done(true))
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault() // Esc → treat as "cancel", clean up ourselves
      done(false)
    })
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) done(false) // click the dark backdrop
    })

    dlg.append(icon, body)
    document.body.append(dlg)
    dlg.showModal()
    ok.focus()
  })
}
