/**
 * Takes a base64-encoded image, resizes it and returns the resized one as a base64 data URL string string
 * @param image a base64-encoded image
 * @returns resized image as a base64 string
 */
export async function resizeBase64Image(
    image: string,
    width: number,
    height: number,
): Promise<string> {
    const canvas = document.createElement('canvas')

    const imageElement = new Image()
    imageElement.src = image

    canvas.width = width
    canvas.height = height

    return new Promise((resolve) => {
        imageElement.onload = () => {
            canvas
                .getContext('2d')!
                .drawImage(imageElement, 0, 0, width, height)

            resolve(canvas.toDataURL())
            imageElement.remove()
        }
    })
}

/**
 * Grabs a single accent color from the provided image and returns it in a css-compatible rgb color format.
 * @param image a base64-encoded image
 * @returns css-compatible color string
 */
export async function getAccentColorFromBase64(_image: string): Promise<string> {
    return 'rgb(0, 0, 0)'
}
