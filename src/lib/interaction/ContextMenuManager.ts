import { Manager } from '../Manager'
import sqs from '../shortQuerySelector'
import type { ContextMenuEntry } from './ContextMenuEntry'

export class ContextMenuManager extends Manager {
    #menuElement: HTMLDivElement = document.createElement('div')

    Initialize(): void {
        this.#initMenuElement()
        this.#initHooks()
    }

    #initMenuElement(): void {
        this.#menuElement.classList.add('contextMenu')
        this.#menuElement.id = 'appContextMenu'
        this.#menuElement.setAttribute('data-visible', 'false')

        sqs('#app').appendChild(this.#menuElement)
    }

    #initHooks(): void {
        document.addEventListener('contextmenu', event => event.preventDefault())
        document.addEventListener('mousedown', event => {
            if (this.#menuElement.getAttribute('data-visible') != 'true')
                return

            const hitbox = {
                topLeft: { x: this.#menuElement.offsetLeft, y: this.#menuElement.offsetTop },
                bottomRight: { x: this.#menuElement.offsetLeft + this.#menuElement.offsetWidth, y: this.#menuElement.offsetTop + this.#menuElement.offsetHeight }
            }

            let wasOutside = false
            if (
                event.x < hitbox.topLeft.x ||
                event.x > hitbox.bottomRight.x
            ) wasOutside = true

            if (
                event.y < hitbox.topLeft.y ||
                event.y > hitbox.bottomRight.y
            ) wasOutside = true

            if (wasOutside) {
                this.HideContextMenu()
                event.preventDefault()
            }
        })
        window.addEventListener('resize', () => {
            if (this.#menuElement.getAttribute('data-visible') == 'false')
                return

            this.HideContextMenu()
        })
    }

    PopulateContextMenu(entries: ContextMenuEntry[]) {
        while (this.#menuElement.lastChild)
            this.#menuElement.removeChild(this.#menuElement.lastChild)

        entries.forEach(entry => {
            const element = document.createElement('div')
            element.classList.add('menuEntry')
            element.classList.add('clickable')
            if (entry.icon) element.appendChild(entry.icon)
            element.appendChild(entry.text)
            element.addEventListener('click', event => {
                entry.onClick(event)
                if (!entry.preventCloseAfterClick)
                    this.HideContextMenu()
            })
            this.#menuElement.appendChild(element)
        })
    }

    HideContextMenu() {
        this.#menuElement.setAttribute('data-visible', 'false')
    }

    ShowContextMenu(x: number, y: number) {
        if (x + this.#menuElement.offsetWidth > window.innerWidth)
            x = window.innerWidth - this.#menuElement.offsetWidth

        if (y + this.#menuElement.offsetHeight > window.innerHeight)
            y = window.innerHeight - this.#menuElement.offsetHeight

        this.#menuElement.style.top  = `${y}px`
        this.#menuElement.style.left = `${x}px`

        this.#menuElement.setAttribute('data-visible', 'true')
    }
}
