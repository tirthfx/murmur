/**
 * A terminal that started the app can go away while it runs. Writing to it then reports
 * `EPIPE` on the stream, which would stop the main process with an error box. That one error
 * is ignored; any other is still raised.
 */
export function ignoreClosedPipes(streams: readonly NodeJS.EventEmitter[]): void {
  for (const stream of streams)
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
}
