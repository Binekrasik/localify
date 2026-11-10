import { Manager } from '../Manager'
import sqs from '../shortQuerySelector'
import type { ContextMenuEntry } from './ContextMenuEntry'
import { reducedMotion } from '../motion'

export class ContextMenuManager extends Manager {
    #menuElement: HTMLDivElement = document.createElement('div')
    #entryArrivals: Animation[] = []

    Initialize(): void {
        this.#initMenuElement()
        this.#initHooks()
    }

    #initMenuElement(): void {
        this.#menuElement.classList.add('contextMenu')
        this.#menuElement.id = 'appContextMenu'
        this.#menuElement.setAttribute('role', 'menu')
        this.#menuElement.setAttribute('data-visible', 'false')

        sqs('#app').appendChild(this.#menuElement)
    }

    #initHooks(): void {
        document.addEventListener('contextmenu', event => event.preventDefault())
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.HideContextMenu()
        })
        // Dismiss before a row's mousedown handler can open a menu at a clamped position.
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
        }, { capture: true })
        window.addEventListener('resize', () => {
            if (this.#menuElement.getAttribute('data-visible') == 'false')
                return

            this.HideContextMenu()
        })
    }

    PopulateContextMenu(entries: ContextMenuEntry[]) {
        this.#cancelEntryArrivals()
        while (this.#menuElement.lastChild)
            this.#menuElement.removeChild(this.#menuElement.lastChild)

        entries.forEach(entry => {
            const element = document.createElement('div')
            element.classList.add('menuEntry')
            element.classList.add('clickable')
            element.setAttribute('role', 'menuitem')
            element.tabIndex = 0
            element.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                if (!event.repeat) element.click()
            })
            if (entry.icon) {
                const icon = document.createElement('span')
                icon.className = 'icon'
                icon.setAttribute('aria-hidden', 'true')
                icon.style.setProperty('--icon', `url('${entry.icon}')`)
                element.appendChild(icon)
            }
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
        for (const animation of this.#entryArrivals) animation.pause()
        this.#menuElement.setAttribute('data-visible', 'false')
    }

    #cancelEntryArrivals() {
        for (const animation of this.#entryArrivals) animation.cancel()
        this.#entryArrivals = []
    }

    ShowContextMenu(x: number, y: number, pivot: 'top-left' | 'bottom-right' = 'top-left') {
        const padding = 10
        const { width, height } = this.#menuElement.getBoundingClientRect()
        if (pivot === 'bottom-right') {
            x -= width
            y -= height
        }
        const left = Math.max(padding, Math.min(x, document.documentElement.clientWidth - width - padding))
        const top = Math.max(padding, Math.min(y, document.documentElement.clientHeight - height - padding))
        this.#menuElement.style.top = `${top}px`
        this.#menuElement.style.left = `${left}px`
        this.#menuElement.scrollTop = 0

        this.#menuElement.setAttribute('data-visible', 'true')
        this.#cancelEntryArrivals()
        if (reducedMotion.matches) return
        this.#entryArrivals = [...this.#menuElement.children].map((element, index) => element.animate([
            { opacity: 0, transform: 'translateX(-10px)' },
            { opacity: 1, transform: 'translateX(0)' },
        ], {
            duration: 250,
            delay: index * 35,
            easing: 'cubic-bezier(0, 0.78, 0.17, 1)',
            fill: 'backwards',
        }))
    }
}
