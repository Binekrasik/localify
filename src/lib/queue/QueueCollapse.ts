import sqs from '../shortQuerySelector'

export function initQueueCollapse() {
    const app = sqs<HTMLElement>('#app')
    const content = sqs<HTMLElement>('#contentContainer')
    const container = sqs<HTMLElement>('#queueContainer')
    const button = sqs<HTMLButtonElement>('#queue-button-collapse')

    button.addEventListener('click', () => {
        const collapsed = button.getAttribute('aria-pressed') !== 'true'
        app.dataset.zen = String(collapsed)
        container.dataset.collapsable = String(collapsed)
        button.setAttribute('aria-pressed', String(collapsed))
        button.title = collapsed ? 'Expand queue' : 'Collapse queue'

        // The pointer is still over the button, so hover alone would hold the sidebar open.
        if (collapsed) container.dataset.revealSuppressed = 'true'
        else delete container.dataset.revealSuppressed
    })

    const allowReveal = () => delete container.dataset.revealSuppressed
    container.addEventListener('pointerleave', allowReveal)
    container.addEventListener('focusout', allowReveal)

    // Focusing a control in the off-screen part of the sidebar would otherwise scroll the clipped layout.
    content.addEventListener('scroll', () => {
        content.scrollLeft = 0
    })
}
