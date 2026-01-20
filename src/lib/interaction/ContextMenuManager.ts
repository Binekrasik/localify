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
            console.log('before clicked')
            if (this.#menuElement.getAttribute('data-visible') != 'true')
                return

            console.log('clicked')

            const hitbox = {
                topLeft: { x: this.#menuElement.offsetLeft, y: this.#menuElement.offsetTop },
                bottomRight: { x: this.#menuElement.offsetLeft + this.#menuElement.offsetWidth, y: this.#menuElement.offsetTop + this.#menuElement.offsetHeight }
            }

            // check if the click was outside of the menu element
            let wasOutside = false
            if (
                event.x < hitbox.topLeft.x ||
                event.x > hitbox.bottomRight.x
            ) wasOutside = true

            if (
                event.y < hitbox.topLeft.y ||
                event.y > hitbox.bottomRight.y
            ) wasOutside = true

            // hide the menu accordingly
            if (wasOutside) {
                console.log('hiding menu')

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

    /**
     * Cleans and populates the context menu with provided `entries`
     * @param entries content of the context menu
     */
    PopulateContextMenu(entries: ContextMenuEntry[]) {
        console.log('populating')

        while (this.#menuElement.lastChild)
            this.#menuElement.removeChild(this.#menuElement.lastChild)

        // populate menu with provided entries
        entries.forEach(entry => {
            const element = document.createElement('div')

            // entry attributes
            element.classList.add('menuEntry')
            element.classList.add('clickable')

            // apply content
            if (entry.icon) element.appendChild(entry.icon)
            element.appendChild(entry.text)
            element.addEventListener('click', event => {
                entry.onClick(event)

                if (!entry.preventCloseAfterClick)
                    this.HideContextMenu()
            })

            // add entry to the context menu
            this.#menuElement.appendChild(element)
        })
    }

    HideContextMenu() {
        this.#menuElement.setAttribute('data-visible', 'false')
    }

    /**
     * Makes the context menu visible
     * @param x left offset in css px
     * @param y top offset in css px
     */
    ShowContextMenu(x: number, y: number) {
        if (x + this.#menuElement.offsetWidth > window.innerWidth)
            x = window.innerWidth - this.#menuElement.offsetWidth

        if (y + this.#menuElement.offsetHeight > window.innerHeight)
            x = window.innerHeight - this.#menuElement.offsetHeight

        this.#menuElement.style.top  = `${y}px`
        this.#menuElement.style.left = `${x}px`

        this.#menuElement.setAttribute('data-visible', 'true')
    }
}
