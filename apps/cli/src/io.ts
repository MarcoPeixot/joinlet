/** Where a command writes: stdout, stderr and the working directory it was invoked from. */
export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export const consoleIo: CliIo = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};
