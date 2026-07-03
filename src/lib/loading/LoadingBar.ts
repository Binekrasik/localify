import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'

export class LoadingBar extends Manager {
    #element = sqs<HTMLDivElement>('#loadingBar')
    #label = sqs<HTMLSpanElement>('#loadingBar .label')
    #fill = sqs<HTMLDivElement>('#loadingBar .fill')

    Initialize(): void {}

    Show(total: number) {
        this.#element.removeAttribute('data-hidden')
        this.Update(0, total)
    }

    Update(current: number, total: number) {
        this.#label.textContent = `Loading file ${current + 1} of ${total}`
        this.#fill.style.width = `${((current + 1) / total) * 100}%`
    }

    Hide() {
        this.#element.setAttribute('data-hidden', 'true')
        this.#fill.style.width = '0%'
    }
}
