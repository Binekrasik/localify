export default function sqs(query: string): Element {
    const element = document.querySelector(query)

    if (!(element instanceof Element))
        throw new Error(`Failed to process a short element query: ${query}`)

    return element
}

export function sqsa(query: string): Element[] {
    const elements = document.querySelectorAll(query)
    return [...elements]
}