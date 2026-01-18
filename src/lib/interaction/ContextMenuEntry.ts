export interface ContextMenuEntry {
    icon?: HTMLImageElement
    text: HTMLParagraphElement
    onClick: (event: PointerEvent) => void
}
