/** A failure whose message is worded in pt-BR for the person: safe to show as is (anything else stays in the log). */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
