export type ElementAttributes = {
    [key: string]: string
}

export function createElement<T extends keyof HTMLElementTagNameMap>(tag: T, attributes?: ElementAttributes, text?: string, ...children: Element[]): HTMLElementTagNameMap[T] {
    const element = document.createElement(tag)

    if (attributes)
        for (let key in attributes)
            element.setAttribute(key, attributes[key])

    element.innerText = `${text}`
    children.forEach(child => element.appendChild(child))

    return element
}
