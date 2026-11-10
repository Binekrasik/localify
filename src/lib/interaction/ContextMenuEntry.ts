export interface ContextMenuEntry {
    icon?: string
    text: HTMLParagraphElement
    preventCloseAfterClick?: boolean
    onClick: (event: PointerEvent) => void
}
