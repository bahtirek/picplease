import type { PushMessage, PushOutcome, PushProvider, PushTarget } from '../push.provider';

/** Test double: records every push and answers with a per-token outcome (default sent). */
export class RecordingPushProvider implements PushProvider {
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];
  readonly outcomes = new Map<string, PushOutcome>();

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ target, message });
    return Promise.resolve(this.outcomes.get(target.token) ?? 'sent');
  }
}
