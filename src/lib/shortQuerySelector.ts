export default function sqs<T extends HTMLElement>(query: string): T {
    const element = document.querySelector(query)

    if (!(element instanceof HTMLElement))
        throw new Error(`Failed to process a short element query: ${query}`)

    return element as T
}

export function sqsa(query: string): Element[] {
    const elements = document.querySelectorAll(query)
    return [...elements]
}
