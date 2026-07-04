export function delay(timeMs = 1000): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, timeMs);
    });
}
