export interface ContextMenuEntry {
    icon?: HTMLImageElement
    text: HTMLParagraphElement
    preventCloseAfterClick?: boolean
    onClick: (event: PointerEvent) => void
}
