import sqs from '../shortQuerySelector'
import { Manager } from '../Manager'

export class LoadingBarManager extends Manager {
    #element = sqs<HTMLDivElement>('#loadingBar')
    #label = sqs<HTMLSpanElement>('#loadingBar .label')
    #fill = sqs<HTMLDivElement>('#loadingBar .fill')

    Initialize(): void {}

    Show(total: number) {
        this.#element.dataset.idle = 'false'
        this.Update(0, total)
    }

    Update(current: number, total: number) {
        this.#label.textContent = `Loading ${current + 1}/${total} media files`
        this.#fill.style.width = `${((current + 1) / total) * 100}%`
    }

    Hide() {
        this.#element.dataset.idle = 'true'
        this.#label.textContent = 'Nothing to do.'
        this.#fill.style.width = '0%'
    }
}
